//go:build linux

package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestMain(tests *testing.M) {
	if len(os.Args) == 2 && os.Args[1] == "--filled-diagnostic" {
		os.Exit(filledDiagnosticCase())
	}
	if len(os.Args) == 3 && os.Args[1] == "--inherited-transport" {
		os.Exit(inheritedTransportCase(os.Args[2]))
	}
	if len(os.Args) == 2 && os.Args[1] == "--pipe-probe" {
		os.Exit(runProbe())
	}
	if len(os.Args) == 3 && os.Args[1] == "--test-child" {
		os.Exit(testChild(os.Args[2]))
	}
	os.Exit(tests.Run())
}

// Only the Go test executable recognizes these cases. They carry fixed public
// markers; no runtime command selection or model-source execution is added.
func testChild(mode string) int {
	switch mode {
	case "blocked":
		time.Sleep(time.Minute)
		return 3
	case "early-close":
		for fd := 3; fd <= 5; fd++ {
			_ = syscall.Close(fd)
		}
		time.Sleep(time.Minute)
		return 3
	case "stdout":
		_, _ = io.WriteString(os.Stdout, strings.Repeat("PUBLIC_OUTPUT", 1024))
		return 0
	case "stderr":
		_, _ = io.WriteString(os.Stderr, strings.Repeat("PUBLIC_ERROR", 1024))
		return 0
	case "diagnostic":
		_, _ = io.WriteString(os.Stderr, "PUBLIC_CHILD_DIAGNOSTIC")
		return 0
	case "failed":
		_, _ = io.WriteString(os.Stdout, "PUBLIC_PARTIAL_OUTPUT")
		return 7
	case "sequential":
		for index := 0; index < 3; index++ {
			file, err := os.Open("/proc/self/fd/" + strconv.Itoa(index+3))
			if err != nil {
				return 8
			}
			value, err := io.ReadAll(io.LimitReader(file, maxInput+1))
			_ = file.Close()
			if err != nil || len(value) != maxInput || !bytes.Equal(value, bytes.Repeat([]byte{byte('a' + index)}, maxInput)) {
				return 9
			}
		}
		_, _ = io.WriteString(os.Stdout, "{\"public\":true}\n")
		return 0
	}
	return 2
}

func testExecutable(t *testing.T) *os.File {
	t.Helper()
	self, err := os.Open("/proc/self/exe")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = self.Close() })
	return self
}

func TestActualAnonymousReopenAndFD6ExecProbe(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := pipeProbe(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestConcurrentLargeWritersSupportSequentialCompilerReads(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	var frames [3]inputFrame
	for index := range frames {
		frames[index].bytes = bytes.Repeat([]byte{byte('a' + index)}, maxInput)
	}
	defer clearFrames(&frames)
	output, err := executeThree(ctx, testExecutable(t), []string{"--test-child", "sequential"}, frames, 128, 128)
	if err != nil || string(output) != "{\"public\":true}\n" {
		t.Fatal("sequential reader transport failed")
	}
}

func TestOverflowAndCompilerFailuresReturnNoContent(t *testing.T) {
	for _, entry := range []struct {
		mode     string
		expected error
	}{
		{"stdout", errOutput}, {"stderr", errOutput}, {"diagnostic", errCompiler}, {"failed", errCompiler},
	} {
		t.Run(entry.mode, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			output, err := executeThree(ctx, testExecutable(t), []string{"--test-child", entry.mode}, [3]inputFrame{}, 128, 128)
			if output != nil || !errors.Is(err, entry.expected) {
				t.Fatal("failed child retained output or wrong closed reason")
			}
		})
	}
}

func TestCancellationAndBrokenPipeJoinWritersAndChild(t *testing.T) {
	for _, mode := range []string{"blocked", "early-close"} {
		t.Run(mode, func(t *testing.T) {
			var frames [3]inputFrame
			for index := range frames {
				frames[index].bytes = bytes.Repeat([]byte("p"), maxInput)
			}
			defer clearFrames(&frames)
			budget := 100 * time.Millisecond
			if mode == "early-close" {
				budget = 2 * time.Second
			}
			ctx, cancel := context.WithTimeout(context.Background(), budget)
			defer cancel()
			started := time.Now()
			output, err := executeThree(ctx, testExecutable(t), []string{"--test-child", mode}, frames, 128, 128)
			if output != nil || err == nil || time.Since(started) > time.Second {
				t.Fatal("blocked process or writers did not terminate promptly")
			}
			if mode == "blocked" && !errors.Is(err, errDeadline) {
				t.Fatal("deadline was not preserved")
			}
		})
	}
}

func admittedSnapshot() hostSnapshot {
	return hostSnapshot{"6.14.0", "12345678-1234-1234-1234-123456789abc\n", "Filename\tType\tSize\tUsed\tPriority\n", "core\n", 0}
}
func TestHostBoundaryFailsClosed(t *testing.T) {
	if admitSnapshot(admittedSnapshot()) != nil {
		t.Fatal("reviewed native snapshot rejected")
	}
	for _, change := range []func(*hostSnapshot){
		func(v *hostSnapshot) { v.kernel = "6.6.0-microsoft-standard-WSL2" },
		func(v *hostSnapshot) { v.kernel = "6.10.14-linuxkit" },
		func(v *hostSnapshot) { v.boot = "unknown" },
		func(v *hostSnapshot) { v.swaps += "/swapfile file 1024 0 -2\n" },
		func(v *hostSnapshot) { v.swaps = "" },
		func(v *hostSnapshot) { v.corePattern = "|/public/collector" },
		func(v *hostSnapshot) { v.corePattern = "@/public/socket" },
		func(v *hostSnapshot) { v.corePattern = "unknown" },
		func(v *hostSnapshot) { v.coreLimit = 1 },
	} {
		value := admittedSnapshot()
		change(&value)
		if admitSnapshot(value) == nil {
			t.Fatal("unsupported host admitted")
		}
	}
}

func TestRegularContentFilesRejectedAndAnonymousPipesAdmitted(t *testing.T) {
	// Only a fixed public marker is written by this test; no candidate is used.
	file, err := os.CreateTemp(t.TempDir(), "public-marker")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if admitStream(file) == nil {
		t.Fatal("regular input/output file admitted")
	}
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	defer writer.Close()
	if admitStream(reader) != nil || admitStream(writer) != nil {
		t.Fatal("anonymous pipe rejected")
	}
}

func TestPreflightFailureEmitsNoReadyAndDoesNotWaitForInput(t *testing.T) {
	input, sender, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	defer sender.Close()
	receiver, output, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer receiver.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	err = run(ctx, []string{"--compiler", "/nonexistent-public-compiler", "--compiler-sha256", strings.Repeat("0", 64)}, input, output)
	_ = output.Close()
	bytes, readError := io.ReadAll(receiver)
	if !errors.Is(err, errAdmission) || readError != nil || len(bytes) != 0 {
		t.Fatal("preflight accepted content or emitted READY")
	}
	if ctx.Err() != nil {
		t.Fatal("preflight read candidate stdin before admission")
	}
}

func TestOptInActualReadonlyLinuxCompilerAdmission(t *testing.T) {
	if os.Getenv("CLOUDMARKUP_ANONYMOUS_NORMALIZATION_PROOF") != "1" {
		t.Skip("requires separately admitted native Linux and actual read-only compiler mount")
	}
	path := os.Getenv("CLOUDMARKUP_TEST_COMPILER_EXECUTABLE")
	digest := os.Getenv("CLOUDMARKUP_TEST_COMPILER_SHA256")
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if _, err := admitHost(); err != nil {
		t.Fatal("native host admission unavailable")
	}
	executable, err := openCompiler(ctx, path, digest)
	if err != nil {
		t.Fatal("exact readonly compiler admission unavailable")
	}
	defer executable.Close()
	if err := pipeProbe(ctx); err != nil {
		t.Fatal("actual fd reopening/exec probe failed")
	}
	wrong := sha256.Sum256([]byte("fixed-public-wrong-compiler-digest"))
	if file, err := openCompiler(ctx, path, hex.EncodeToString(wrong[:])); err == nil {
		file.Close()
		t.Fatal("wrong executable digest admitted")
	}
}

func TestReadOnlyModeIsNotAReadOnlyMount(t *testing.T) {
	path := t.TempDir() + "/public-executable"
	value := []byte("fixed-public-bytes-not-a-candidate")
	if err := os.WriteFile(path, value, 0555); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(value)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if file, err := openCompiler(ctx, path, hex.EncodeToString(sum[:])); err == nil {
		file.Close()
		t.Fatal("chmod-only executable was admitted as a read-only mount")
	}
}

func TestProbeAndCanceledWritersDoNotLeakDescriptors(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	if err := pipeProbe(ctx); err != nil {
		cancel()
		t.Fatal(err)
	}
	cancel()
	self := testExecutable(t)
	before, err := os.ReadDir("/proc/self/fd")
	if err != nil {
		t.Fatal(err)
	}
	for index := 0; index < 3; index++ {
		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		_, err := executeThree(ctx, self, []string{"--test-child", "blocked"}, probeFrames(), 128, 128)
		cancel()
		if !errors.Is(err, errDeadline) {
			t.Fatal("canceled child unexpectedly passed")
		}
	}
	after, err := os.ReadDir("/proc/self/fd")
	if err != nil || len(after) != len(before) {
		t.Fatal("owned process descriptors leaked")
	}
}
