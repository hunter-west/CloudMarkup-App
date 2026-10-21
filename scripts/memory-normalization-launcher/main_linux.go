//go:build linux

package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"io"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

func emitLine(writer io.Writer, value any) error {
	body, err := json.Marshal(value)
	if err != nil {
		return errTransport
	}
	return writeAll(writer, append(body, '\n'))
}

func run(ctx context.Context, args []string, input, output *os.File) (resultError error) {
	flags := flag.NewFlagSet("anonymous-normalization", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	path := flags.String("compiler", "", "trusted parent compiler path")
	digest := flags.String("compiler-sha256", "", "trusted parent Linux executable SHA-256")
	if flags.Parse(args) != nil || flags.NArg() != 0 || *path == "" || *digest == "" {
		return errAdmission
	}
	owned, err := ownParentTransports(ctx, input, output)
	if err != nil {
		return err
	}
	defer func() {
		if owned.release() != nil {
			resultError = errTransport
			return
		}
		deadline, hasDeadline := ctx.Deadline()
		if ctx.Err() != nil || (hasDeadline && !time.Now().Before(deadline)) {
			resultError = errDeadline
		}
	}()
	input = owned.input.file
	output = owned.output.file
	// Only owned pollable wrappers are used below; caller descriptors survive.
	host, err := admitHost()
	if err != nil {
		return err
	}
	executable, err := openCompiler(ctx, *path, *digest)
	if err != nil {
		return err
	}
	defer executable.Close()
	if pipeProbe(ctx) != nil {
		return errAdmission
	}
	if ctx.Err() != nil {
		return errDeadline
	}
	if emitLine(output, map[string]any{
		"kind": protocol, "phase": "ready", "compilerSha256": *digest,
		"kernelBootId": strings.TrimSpace(host.boot),
	}) != nil {
		return errTransport
	}
	frames, err := readFrames(input)
	if err != nil {
		if ctx.Err() != nil {
			return errDeadline
		}
		return err
	}
	defer clearFrames(&frames)
	currentHost, err := admitHost()
	if err != nil || currentHost != host {
		return errAdmission
	}
	result, err := executeThree(ctx, executable, normalizeArguments(), frames, maxOutput, maxStderr)
	if err != nil {
		return err
	}
	defer clear(result)
	if len(result) == 0 || !json.Valid(result) {
		return errCompiler
	}
	// No result bytes escape before completion, empty compiler stderr, joined
	// process/writers and post-execution environmental admission.
	finalHost, err := admitHost()
	if err != nil || finalHost != host || ctx.Err() != nil {
		return errAdmission
	}
	inputs := make([]map[string]any, len(frames))
	for index, name := range []string{"architecture", "workload", "solution-revision"} {
		inputs[index] = map[string]any{"kind": name, "byteLength": len(frames[index].bytes), "sha256": frames[index].digest}
	}
	sum := sha256.Sum256(result)
	if emitLine(output, map[string]any{
		"kind": protocol, "phase": "result", "compilerSha256": *digest,
		"inputs": inputs, "stdoutBytes": len(result), "stdoutSha256": hex.EncodeToString(sum[:]),
		"stderrBytes": 0,
	}) != nil {
		return errTransport
	}
	return writeAll(output, result)
}

func exitCode() (code int) {
	defer func() {
		if recover() != nil {
			writeDiagnostic("internal")
			code = 1
		}
	}()
	if len(os.Args) == 2 && os.Args[1] == "--pipe-probe" {
		return runProbe()
	}
	signals, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	ctx, cancel := context.WithTimeout(signals, 30*time.Second)
	defer cancel()
	err := run(ctx, os.Args[1:], os.Stdin, os.Stdout)
	if err == nil {
		return 0
	}
	reason := "failed"
	switch err {
	case errAdmission:
		reason = "admission"
	case errProtocol:
		reason = "input-protocol"
	case errCompiler:
		reason = "compiler"
	case errDeadline:
		reason = "deadline"
	case errOutput:
		reason = "output-limit"
	case errTransport:
		reason = "transport"
	}
	writeDiagnostic(reason)
	return 1
}
func main() { os.Exit(exitCode()) }
