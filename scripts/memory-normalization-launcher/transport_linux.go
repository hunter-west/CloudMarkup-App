//go:build linux

package main

import (
	"context"
	"os"
	"strconv"
	"sync"
	"syscall"
	"unsafe"
)

// F_DUPFD shares an open-file description: O_NONBLOCK is temporarily visible
// through the caller's descriptor too. The caller grants exclusive use until
// release returns. Never close the caller's descriptor. Restore its exact status
// flags only after all owned operations and the cancellation watcher have joined.
type ownedTransport struct {
	file         *os.File
	source       *os.File
	identity     syscall.Stat_t
	flags        int
	closeOnce    sync.Once
	closeError   error
	releaseOnce  sync.Once
	releaseError error
}

func descriptorFlags(fd int, operation int, value int) (int, error) {
	for {
		result, _, err := syscall.Syscall(syscall.SYS_FCNTL, uintptr(fd), uintptr(operation), uintptr(value))
		if err == syscall.EINTR {
			continue
		}
		if err != 0 {
			return 0, err
		}
		return int(result), nil
	}
}

func sameDescriptor(left, right syscall.Stat_t) bool {
	return left.Dev == right.Dev && left.Ino == right.Ino &&
		left.Mode == right.Mode && left.Rdev == right.Rdev
}

// syscall.Getsockname/Getpeername discard sockaddr length and normalize a
// leading NUL to "@". That aliases truly unnamed sockets with an empty abstract
// address. Inspect the kernel-returned family-only length for BOTH endpoints.
func unnamedUnixEndpoint(fd int, operation uintptr) bool {
	if operation != syscall.SYS_GETSOCKNAME && operation != syscall.SYS_GETPEERNAME {
		return false
	}
	for {
		var address syscall.RawSockaddrUnix
		length := uint32(unsafe.Sizeof(address))
		_, _, errno := syscall.Syscall(operation, uintptr(fd),
			uintptr(unsafe.Pointer(&address)), uintptr(unsafe.Pointer(&length)))
		if errno == syscall.EINTR {
			continue
		}
		return errno == 0 && address.Family == syscall.AF_UNIX &&
			length == uint32(unsafe.Offsetof(address.Path))
	}
}

func admitDescriptor(fd int) error {
	var info syscall.Stat_t
	if syscall.Fstat(fd, &info) != nil {
		return errAdmission
	}
	switch info.Mode & syscall.S_IFMT {
	case syscall.S_IFIFO:
		target, err := os.Readlink("/proc/self/fd/" + strconv.Itoa(fd))
		if err != nil || !anonymousPipePattern.MatchString(target) {
			return errAdmission
		}
		return nil
	case syscall.S_IFSOCK:
		kind, err := syscall.GetsockoptInt(fd, syscall.SOL_SOCKET, syscall.SO_TYPE)
		if err != nil || kind != syscall.SOCK_STREAM {
			return errAdmission
		}
		if unnamedUnixEndpoint(fd, syscall.SYS_GETSOCKNAME) &&
			unnamedUnixEndpoint(fd, syscall.SYS_GETPEERNAME) {
			return nil
		}
	}
	return errAdmission
}

func admitStream(file *os.File) error {
	raw, err := file.SyscallConn()
	if err != nil {
		return errAdmission
	}
	result := errAdmission
	if raw.Control(func(fd uintptr) { result = admitDescriptor(int(fd)) }) != nil {
		return errAdmission
	}
	return result
}

func ownTransport(ctx context.Context, source *os.File, reading bool) (*ownedTransport, error) {
	deadline, hasDeadline := ctx.Deadline()
	if !hasDeadline || ctx.Err() != nil {
		return nil, errAdmission
	}
	raw, err := source.SyscallConn()
	if err != nil {
		return nil, errAdmission
	}
	value := &ownedTransport{source: source}
	setupError := errAdmission
	controlError := raw.Control(func(fd uintptr) {
		number := int(fd)
		if admitDescriptor(number) != nil || syscall.Fstat(number, &value.identity) != nil {
			return
		}
		flags, err := descriptorFlags(number, syscall.F_GETFL, 0)
		if err != nil {
			return
		}
		access := flags & syscall.O_ACCMODE
		if (reading && access == syscall.O_WRONLY) || (!reading && access == syscall.O_RDONLY) {
			return
		}
		value.flags = flags
		duplicate, err := descriptorFlags(number, syscall.F_DUPFD_CLOEXEC, 3)
		if err != nil {
			return
		}
		var copied syscall.Stat_t
		if syscall.Fstat(duplicate, &copied) != nil || !sameDescriptor(value.identity, copied) {
			_ = syscall.Close(duplicate)
			return
		}
		// Set before NewFile: pinned Go kindNewFile only selects runtime polling
		// when the inherited descriptor is already nonblocking.
		if syscall.SetNonblock(duplicate, true) != nil {
			_ = syscall.Close(duplicate)
			return
		}
		value.file = os.NewFile(uintptr(duplicate), "anonymous-normalization-owned")
		if value.file == nil {
			_, _ = descriptorFlags(number, syscall.F_SETFL, flags)
			_ = syscall.Close(duplicate)
			return
		}
		setupError = nil
	})
	if controlError != nil || setupError != nil {
		if value.file != nil {
			_ = value.release()
		}
		return nil, errAdmission
	}
	// Deadline support validates that epoll registration actually succeeded;
	// O_NONBLOCK by itself is insufficient. Never call owned.file.Fd(), which
	// can alter polling mode for some os.File creation paths.
	if reading {
		err = value.file.SetReadDeadline(deadline)
	} else {
		err = value.file.SetWriteDeadline(deadline)
	}
	if err != nil {
		_ = value.release()
		return nil, errAdmission
	}
	return value, nil
}

func (value *ownedTransport) closeOwned() error {
	value.closeOnce.Do(func() { value.closeError = value.file.Close() })
	return value.closeError
}

func (value *ownedTransport) release() error {
	value.releaseOnce.Do(func() {
		if value.closeOwned() != nil {
			value.releaseError = errTransport
		}
		raw, err := value.source.SyscallConn()
		if err != nil {
			value.releaseError = errTransport
			return
		}
		restoreError := errTransport
		err = raw.Control(func(fd uintptr) {
			var current syscall.Stat_t
			if syscall.Fstat(int(fd), &current) != nil || !sameDescriptor(current, value.identity) {
				return
			}
			if _, err := descriptorFlags(int(fd), syscall.F_SETFL, value.flags); err != nil {
				return
			}
			flags, err := descriptorFlags(int(fd), syscall.F_GETFL, 0)
			if err != nil || flags != value.flags {
				return
			}
			restoreError = nil
		})
		if err != nil || restoreError != nil {
			value.releaseError = errTransport
		}
	})
	return value.releaseError
}

type parentTransports struct {
	input, output *ownedTransport
	stop          chan struct{}
	joined        chan struct{}
	releaseOnce   sync.Once
	releaseError  error
}

func ownParentTransports(ctx context.Context, input, output *os.File) (*parentTransports, error) {
	// Type admission precedes any shared descriptor-status mutation.
	if admitStream(input) != nil || admitStream(output) != nil {
		return nil, errAdmission
	}
	// Duplicate open-file descriptions share O_NONBLOCK. Deny identical stream
	// identities across input/output rather than stacking conflicting restorations.
	inputRaw, err := input.SyscallConn()
	if err != nil {
		return nil, errAdmission
	}
	outputRaw, err := output.SyscallConn()
	if err != nil {
		return nil, errAdmission
	}
	var inputState, outputState syscall.Stat_t
	inputError, outputError := errAdmission, errAdmission
	if inputRaw.Control(func(fd uintptr) {
		if syscall.Fstat(int(fd), &inputState) == nil {
			inputError = nil
		}
	}) != nil ||
		outputRaw.Control(func(fd uintptr) {
			if syscall.Fstat(int(fd), &outputState) == nil {
				outputError = nil
			}
		}) != nil ||
		inputError != nil || outputError != nil || sameDescriptor(inputState, outputState) {
		return nil, errAdmission
	}
	reader, err := ownTransport(ctx, input, true)
	if err != nil {
		return nil, err
	}
	writer, err := ownTransport(ctx, output, false)
	if err != nil {
		_ = reader.release()
		return nil, err
	}
	value := &parentTransports{input: reader, output: writer, stop: make(chan struct{}), joined: make(chan struct{})}
	go func() {
		defer close(value.joined)
		select {
		case <-ctx.Done():
			_ = reader.closeOwned()
			_ = writer.closeOwned()
		case <-value.stop:
		}
	}()
	return value, nil
}

func (value *parentTransports) release() error {
	value.releaseOnce.Do(func() {
		close(value.stop)
		<-value.joined
		// The synchronous caller has finished its reads/writes before release.
		// Join the watcher before closing/restoring status flags on both sources.
		if value.input.release() != nil {
			value.releaseError = errTransport
		}
		if value.output.release() != nil {
			value.releaseError = errTransport
		}
	})
	return value.releaseError
}
