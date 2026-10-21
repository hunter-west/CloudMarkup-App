//go:build linux

package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"testing"
	"time"
)

func transportDescriptorState(file *os.File) (int, syscall.Stat_t, error) {
	var state syscall.Stat_t
	flags := 0
	result := errTransport
	raw, err := file.SyscallConn()
	if err != nil {
		return flags, state, errTransport
	}
	if raw.Control(func(fd uintptr) {
		if syscall.Fstat(int(fd), &state) != nil {
			return
		}
		var err error
		flags, err = descriptorFlags(int(fd), syscall.F_GETFL, 0)
		if err == nil {
			result = nil
		}
	}) != nil {
		return flags, state, errTransport
	}
	return flags, state, result
}

// Invoked only by the Go test executable, with actual inherited blocking fd0/1.
// No host admission shortcut is added to the production command.
func inheritedTransportCase(mode string) int {
	inputFlags, inputState, err := transportDescriptorState(os.Stdin)
	if err != nil || inputFlags&syscall.O_NONBLOCK != 0 {
		return 20
	}
	outputFlags, outputState, err := transportDescriptorState(os.Stdout)
	if err != nil || outputFlags&syscall.O_NONBLOCK != 0 {
		return 21
	}
	budget := 150 * time.Millisecond
	if mode == "success" || strings.HasSuffix(mode, "-cancel") {
		budget = 2 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), budget)
	defer cancel()
	owned, err := ownParentTransports(ctx, os.Stdin, os.Stdout)
	if err != nil {
		return 22
	}
	activeInput, activeInState, err := transportDescriptorState(os.Stdin)
	if err != nil || activeInput&syscall.O_NONBLOCK == 0 || !sameDescriptor(inputState, activeInState) {
		return 23
	}
	activeOutput, activeOutState, err := transportDescriptorState(os.Stdout)
	if err != nil || activeOutput&syscall.O_NONBLOCK == 0 || !sameDescriptor(outputState, activeOutState) {
		return 24
	}
	var timer *time.Timer
	if strings.HasSuffix(mode, "-cancel") {
		timer = time.AfterFunc(100*time.Millisecond, cancel)
		defer timer.Stop()
	}
	started := time.Now()
	switch {
	case mode == "success":
		var marker [1]byte
		if _, err := io.ReadFull(owned.input.file, marker[:]); err != nil || marker[0] != 'P' {
			return 25
		}
		if writeAll(owned.output.file, []byte("OK")) != nil {
			return 26
		}
	case strings.HasPrefix(mode, "read-"):
		var marker [1]byte
		_, err = owned.input.file.Read(marker[:])
	case strings.HasPrefix(mode, "write-"):
		_, err = owned.output.file.Write(bytes.Repeat([]byte("PUBLIC"), maxOutput/6))
	default:
		return 27
	}
	if mode != "success" {
		if err == nil || time.Since(started) > time.Second {
			return 28
		}
		if strings.HasSuffix(mode, "-deadline") && !errors.Is(err, os.ErrDeadlineExceeded) && ctx.Err() != context.DeadlineExceeded {
			return 29
		}
		if strings.HasSuffix(mode, "-cancel") && ctx.Err() != context.Canceled {
			return 30
		}
	}
	if owned.release() != nil {
		return 31
	}
	// Both caller files must survive and retain their exact original status,
	// including after deadline/cancel closed the owned wrappers.
	finalInput, finalInState, err := transportDescriptorState(os.Stdin)
	if err != nil || finalInput != inputFlags || !sameDescriptor(inputState, finalInState) {
		return 32
	}
	finalOutput, finalOutState, err := transportDescriptorState(os.Stdout)
	if err != nil || finalOutput != outputFlags || !sameDescriptor(outputState, finalOutState) {
		return 33
	}
	if _, err := io.WriteString(os.Stderr, "transport-check:passed\n"); err != nil {
		return 34
	}
	return 0
}

func inheritedEnds(t *testing.T, kind string) (input, inputPeer, output, outputPeer *os.File) {
	t.Helper()
	pair := func(names [2]string) (*os.File, *os.File) {
		var descriptors [2]int
		var err error
		if kind == "pipe" {
			values := []int{0, 0}
			err = syscall.Pipe2(values, syscall.O_CLOEXEC)
			descriptors = [2]int{values[0], values[1]}
		} else {
			descriptors, err = syscall.Socketpair(syscall.AF_UNIX, syscall.SOCK_STREAM|syscall.SOCK_CLOEXEC, 0)
		}
		if err != nil {
			t.Fatal("Could not create public subprocess transport")
		}
		left := os.NewFile(uintptr(descriptors[0]), names[0])
		right := os.NewFile(uintptr(descriptors[1]), names[1])
		t.Cleanup(func() { _ = left.Close(); _ = right.Close() })
		return left, right
	}
	input, inputPeer = pair([2]string{"public-input-child", "public-input-parent"})
	if kind == "pipe" {
		outputPeer, output = pair([2]string{"public-output-parent", "public-output-child"})
	} else {
		output, outputPeer = pair([2]string{"public-output-child", "public-output-parent"})
	}
	raw, err := output.SyscallConn()
	if err != nil {
		t.Fatal(err)
	}
	var capacityError error
	err = raw.Control(func(fd uintptr) {
		if kind == "pipe" {
			_, capacityError = descriptorFlags(int(fd), syscall.F_SETPIPE_SZ, 4096)
		} else {
			capacityError = syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET, syscall.SO_SNDBUF, 4096)
		}
	})
	if err != nil || capacityError != nil {
		t.Fatal("Could not bound public subprocess output capacity")
	}
	return
}

func TestInheritedBlockingTransportSuccessDeadlineAndCancellation(t *testing.T) {
	for _, kind := range []string{"pipe", "unix-pair"} {
		for _, mode := range []string{"success", "read-deadline", "write-deadline", "read-cancel", "write-cancel"} {
			t.Run(kind+"/"+mode, func(t *testing.T) {
				input, inputPeer, output, _ := inheritedEnds(t, kind)
				if mode == "success" {
					if _, err := inputPeer.Write([]byte("P")); err != nil {
						t.Fatal(err)
					}
				}
				ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
				defer cancel()
				command := exec.CommandContext(ctx, "/proc/self/exe", "--inherited-transport", mode)
				command.Stdin = input
				command.Stdout = output // Parent intentionally does not drain output.
				command.Env = []string{"GOTRACEBACK=none"}
				command.WaitDelay = time.Second
				diagnostic := &boundedCapture{limit: 1024, cancel: cancel}
				command.Stderr = diagnostic
				if command.Start() != nil {
					t.Fatal("Public transport subprocess did not start")
				}
				_ = input.Close()
				_ = output.Close()
				err := command.Wait()
				if err != nil || ctx.Err() != nil || diagnostic.overflow ||
					diagnostic.value.String() != "transport-check:passed\n" {
					exitCode := -1
					if command.ProcessState != nil {
						exitCode = command.ProcessState.ExitCode()
					}
					t.Fatalf("Inherited transport check failed: exit=%d canceled=%t overflow=%t marker=%t",
						exitCode, ctx.Err() != nil, diagnostic.overflow, diagnostic.value.String() == "transport-check:passed\n")
				}
			})
		}
	}
}

func TestAliasedParentDescriptorIdentityDeniedBeforeFlagMutation(t *testing.T) {
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	defer writer.Close()
	before, _, err := transportDescriptorState(reader)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if owned, err := ownParentTransports(ctx, reader, reader); err == nil {
		_ = owned.release()
		t.Fatal("Aliased caller descriptor admitted")
	}
	after, _, err := transportDescriptorState(reader)
	if err != nil || before != after {
		t.Fatal("Denied alias changed caller status")
	}
}

func TestDuplicatedBidirectionalUnixSocketDeniedWithoutStatusMutation(t *testing.T) {
	pair, err := syscall.Socketpair(syscall.AF_UNIX, syscall.SOCK_STREAM|syscall.SOCK_CLOEXEC, 0)
	if err != nil {
		t.Fatal(err)
	}
	source := os.NewFile(uintptr(pair[0]), "public-shared-input")
	peer := os.NewFile(uintptr(pair[1]), "public-shared-peer")
	defer source.Close()
	defer peer.Close()
	duplicate, err := descriptorFlags(pair[0], syscall.F_DUPFD_CLOEXEC, 3)
	if err != nil {
		t.Fatal(err)
	}
	output := os.NewFile(uintptr(duplicate), "public-shared-output")
	defer output.Close()
	beforeSource, beforeIdentity, err := transportDescriptorState(source)
	if err != nil {
		t.Fatal(err)
	}
	beforeOutput, outputIdentity, err := transportDescriptorState(output)
	if err != nil || !sameDescriptor(beforeIdentity, outputIdentity) {
		t.Fatal("test did not duplicate the socket")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if owned, err := ownParentTransports(ctx, source, output); err == nil {
		_ = owned.release()
		t.Fatal("same bidirectional socket was admitted twice")
	}
	afterSource, finalSource, err := transportDescriptorState(source)
	if err != nil || afterSource != beforeSource || !sameDescriptor(beforeIdentity, finalSource) {
		t.Fatal("source status changed on alias denial")
	}
	afterOutput, finalOutput, err := transportDescriptorState(output)
	if err != nil || afterOutput != beforeOutput || !sameDescriptor(outputIdentity, finalOutput) {
		t.Fatal("output status changed on alias denial")
	}
}

func filledDiagnosticCase() int {
	before, identity, err := transportDescriptorState(os.Stderr)
	if err != nil || before&syscall.O_NONBLOCK != 0 {
		return 40
	}
	started := time.Now()
	writeDiagnostic("deadline")
	after, final, err := transportDescriptorState(os.Stderr)
	if err != nil || before != after || !sameDescriptor(identity, final) || time.Since(started) > time.Second {
		return 41
	}
	if _, err := io.WriteString(os.Stdout, "diagnostic-check:passed\n"); err != nil {
		return 42
	}
	return 0
}

func TestFilledInheritedDiagnosticPipeDropsWithoutBlockingOrClosingCaller(t *testing.T) {
	pair := []int{0, 0}
	if err := syscall.Pipe2(pair, syscall.O_CLOEXEC); err != nil {
		t.Fatal(err)
	}
	reader := os.NewFile(uintptr(pair[0]), "public-diagnostic-parent")
	writer := os.NewFile(uintptr(pair[1]), "public-diagnostic-child")
	defer reader.Close()
	defer writer.Close()
	capacity, err := descriptorFlags(pair[1], syscall.F_SETPIPE_SZ, 4096)
	if err != nil || capacity < 4096 || capacity > maxInput {
		t.Fatal("Could not bound public diagnostic pipe")
	}
	count, err := syscall.Write(pair[1], bytes.Repeat([]byte("P"), capacity))
	if err != nil || count != capacity {
		t.Fatal("Public diagnostic pipe was not filled")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, "/proc/self/exe", "--filled-diagnostic")
	command.Env = []string{"GOTRACEBACK=none"}
	command.WaitDelay = time.Second
	result := &boundedCapture{limit: 1024, cancel: cancel}
	command.Stdout = result
	command.Stderr = writer // Intentionally full and undrained until after Wait.
	if command.Start() != nil {
		t.Fatal("Public diagnostic subprocess did not start")
	}
	_ = writer.Close()
	if command.Wait() != nil || ctx.Err() != nil || result.overflow ||
		result.value.String() != "diagnostic-check:passed\n" {
		t.Fatal("Filled inherited diagnostic pipe prevented bounded completion")
	}
}

func TestUnnamedUnixEndpointsUseKernelLengthNotLossyGoName(t *testing.T) {
	pair, err := syscall.Socketpair(syscall.AF_UNIX, syscall.SOCK_STREAM|syscall.SOCK_CLOEXEC, 0)
	if err != nil {
		t.Fatal("Could not create public unnamed socket pair")
	}
	defer syscall.Close(pair[0])
	defer syscall.Close(pair[1])
	for _, fd := range pair {
		local, err := syscall.Getsockname(fd)
		if err != nil {
			t.Fatal("Could not observe fixed public socket name")
		}
		converted, ok := local.(*syscall.SockaddrUnix)
		if !ok || converted.Name != "@" {
			t.Fatal("Pinned Go lossy unnamed-socket conversion differs")
		}
		if !unnamedUnixEndpoint(fd, syscall.SYS_GETSOCKNAME) ||
			!unnamedUnixEndpoint(fd, syscall.SYS_GETPEERNAME) || admitDescriptor(fd) != nil {
			t.Fatal("Actual unnamed connected stream was rejected")
		}
	}
}

func TestNamedAndAbstractUnixEndpointsNeverAcquireTransportAuthority(t *testing.T) {
	for _, kind := range []string{"abstract-empty", "abstract-embedded-nul", "pathname"} {
		t.Run(kind, func(t *testing.T) {
			listener, err := syscall.Socket(syscall.AF_UNIX, syscall.SOCK_STREAM|syscall.SOCK_CLOEXEC, 0)
			if err != nil {
				t.Fatal("Could not create public listener")
			}
			defer syscall.Close(listener)
			name := "@"
			if kind == "abstract-embedded-nul" {
				name = "@cloudmarkup-public\x00tail"
			}
			if kind == "pathname" {
				name = t.TempDir() + "/public.sock"
			}
			address := &syscall.SockaddrUnix{Name: name}
			if syscall.Bind(listener, address) != nil || syscall.Listen(listener, 1) != nil {
				t.Fatal("Could not bind fixed public Unix listener")
			}
			client, err := syscall.Socket(syscall.AF_UNIX, syscall.SOCK_STREAM|syscall.SOCK_CLOEXEC, 0)
			if err != nil {
				t.Fatal("Could not create public client")
			}
			defer syscall.Close(client)
			if syscall.Connect(client, address) != nil {
				t.Fatal("Could not connect public Unix client")
			}
			accepted, _, err := syscall.Accept4(listener, syscall.SOCK_CLOEXEC)
			if err != nil {
				t.Fatal("Could not accept public Unix client")
			}
			defer syscall.Close(accepted)
			// The client is itself unnamed but its peer is named/abstract. The
			// accepted end has the reverse identities. Both directions must deny.
			if !unnamedUnixEndpoint(client, syscall.SYS_GETSOCKNAME) ||
				unnamedUnixEndpoint(client, syscall.SYS_GETPEERNAME) ||
				unnamedUnixEndpoint(accepted, syscall.SYS_GETSOCKNAME) ||
				admitDescriptor(client) == nil || admitDescriptor(accepted) == nil {
				t.Fatal("Named or abstract endpoint acquired anonymous authority")
			}
			if kind == "abstract-empty" {
				peer, err := syscall.Getpeername(client)
				if err != nil {
					t.Fatal("Could not observe public empty abstract address")
				}
				converted, ok := peer.(*syscall.SockaddrUnix)
				if !ok || converted.Name != "@" {
					t.Fatal("Empty abstract test does not reproduce the lossy Go-name alias")
				}
			}
		})
	}
}

func TestUnconnectedAndDatagramUnixDescriptorsRemainDenied(t *testing.T) {
	fd, err := syscall.Socket(syscall.AF_UNIX, syscall.SOCK_STREAM|syscall.SOCK_CLOEXEC, 0)
	if err != nil {
		t.Fatal("Could not create public unconnected socket")
	}
	defer syscall.Close(fd)
	if admitDescriptor(fd) == nil {
		t.Fatal("Unconnected stream was admitted")
	}
	pair, err := syscall.Socketpair(syscall.AF_UNIX, syscall.SOCK_DGRAM|syscall.SOCK_CLOEXEC, 0)
	if err != nil {
		t.Fatal("Could not create public datagram pair")
	}
	defer syscall.Close(pair[0])
	defer syscall.Close(pair[1])
	if admitDescriptor(pair[0]) == nil || admitDescriptor(pair[1]) == nil {
		t.Fatal("Datagram socket was admitted as a stream")
	}
}
