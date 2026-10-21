//go:build linux

package main

import (
	"bytes"
	"context"
	"io"
	"os"
	"os/exec"
	"strconv"
	"sync"
	"syscall"
	"time"
)

type boundedCapture struct {
	value    bytes.Buffer
	limit    int
	overflow bool
	cancel   context.CancelFunc
}

func (capture *boundedCapture) Write(value []byte) (int, error) {
	if len(value) > capture.limit-capture.value.Len() {
		capture.overflow = true
		capture.cancel()
		return 0, errOutput
	}
	return capture.value.Write(value)
}

func normalizeArguments() []string {
	return []string{"normalize",
		"--architecture", "/proc/self/fd/3",
		"--workload", "/proc/self/fd/4",
		"--solution-revision", "/proc/self/fd/5",
		"--target", "terraform", "--output", "-",
		"--max-input-bytes", "1048576", "--max-output-bytes", "2097152"}
}

func executeThree(ctx context.Context, executable *os.File, arguments []string, frames [3]inputFrame, stdoutLimit, stderrLimit int) ([]byte, error) {
	childContext, cancel := context.WithCancel(ctx)
	defer cancel()
	var readers, writers [3]*os.File
	closePipes := func() {
		for _, file := range readers {
			if file != nil {
				_ = file.Close()
			}
		}
		for _, file := range writers {
			if file != nil {
				_ = file.Close()
			}
		}
	}
	defer closePipes()
	for index := range readers {
		var err error
		readers[index], writers[index], err = os.Pipe()
		if err != nil {
			return nil, errTransport
		}
	}
	extras := []*os.File{readers[0], readers[1], readers[2], executable}
	// Execute the exact held, hashed descriptor; never resolve a mutable path
	// again. ExtraFiles preserves fd6 for execve of /proc/self/fd/6.
	command := exec.CommandContext(childContext, "/proc/self/fd/6", arguments...)
	command.ExtraFiles = extras
	command.Env = []string{"GOTRACEBACK=none"}
	command.Dir = "/"
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true, Pdeathsig: syscall.SIGKILL}
	command.WaitDelay = time.Second
	// Keep CommandContext's default Process.Kill: Go protects direct-child
	// identity with PIDFD/status synchronization. A raw kill(-pid) can race
	// Wait/reaping and numeric process-group reuse. The exact pinned normalizer
	// and public self-probe do not execute descendant commands.
	stdout := &boundedCapture{limit: stdoutLimit, cancel: cancel}
	stderr := &boundedCapture{limit: stderrLimit, cancel: cancel}
	command.Stdout = stdout
	command.Stderr = stderr
	if command.Start() != nil {
		return nil, errCompiler
	}
	for _, file := range readers {
		_ = file.Close()
	}
	// A cancellation also closes pipe writers, interrupting blocked writes even
	// when the child stopped reading. Join the watcher and every writer below.
	stopWatcher := make(chan struct{})
	watcherDone := make(chan struct{})
	go func() {
		defer close(watcherDone)
		select {
		case <-childContext.Done():
			for _, file := range writers {
				_ = file.Close()
			}
		case <-stopWatcher:
		}
	}()
	writerResults := make(chan error, len(writers))
	var joined sync.WaitGroup
	for index, file := range writers {
		joined.Add(1)
		go func(index int, file *os.File) {
			defer joined.Done()
			defer file.Close()
			writeError := writeAll(file, frames[index].bytes)
			if writeError != nil {
				cancel()
			}
			writerResults <- writeError
		}(index, file)
	}
	waitError := command.Wait() // Also joins exec's bounded stdout/stderr copies.
	for _, file := range writers {
		_ = file.Close()
	}
	joined.Wait()
	close(stopWatcher)
	<-watcherDone
	close(writerResults)
	defer clear(stderr.value.Bytes())
	if stdout.overflow || stderr.overflow {
		clear(stdout.value.Bytes())
		return nil, errOutput
	}
	if ctx.Err() != nil {
		clear(stdout.value.Bytes())
		return nil, errDeadline
	}
	if waitError != nil || stderr.value.Len() != 0 {
		clear(stdout.value.Bytes())
		return nil, errCompiler
	}
	for err := range writerResults {
		if err != nil {
			clear(stdout.value.Bytes())
			return nil, errTransport
		}
	}
	return stdout.value.Bytes(), nil
}

const probeOutput = "anonymous-pipes-and-exec-descriptor-v1\n"

func probeFrames() [3]inputFrame {
	return [3]inputFrame{
		{bytes: []byte("public-architecture-marker-v1")},
		{bytes: []byte("public-workload-marker-v1")},
		{bytes: []byte("public-revision-marker-v1")},
	}
}
func pipeProbe(ctx context.Context) error {
	self, err := os.Open("/proc/self/exe")
	if err != nil {
		return errAdmission
	}
	defer self.Close()
	output, err := executeThree(ctx, self, []string{"--pipe-probe"}, probeFrames(), 256, 256)
	if err != nil || string(output) != probeOutput {
		return errAdmission
	}
	return nil
}
func runProbe() int {
	want := probeFrames()
	for index := range want {
		file, err := os.Open("/proc/self/fd/" + strconv.Itoa(index+3))
		if err != nil {
			return 1
		}
		info, err := file.Stat()
		if err != nil || info.Mode()&os.ModeNamedPipe == 0 {
			file.Close()
			return 1
		}
		value, readError := io.ReadAll(io.LimitReader(file, 128))
		closeError := file.Close()
		if readError != nil || closeError != nil || !bytes.Equal(value, want[index].bytes) {
			return 1
		}
	}
	self, err := os.Stat("/proc/self/exe")
	if err != nil {
		return 1
	}
	executed, err := os.Stat("/proc/self/fd/6")
	if err != nil || !os.SameFile(self, executed) {
		return 1
	}
	if writeAll(os.Stdout, []byte(probeOutput)) != nil {
		return 1
	}
	return 0
}
