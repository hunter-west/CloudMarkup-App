//go:build linux

package main

import (
	"os"
	"syscall"
)

// Failure diagnostics are optional metadata. Never turn failure reporting into
// a blocking transport or leak arbitrary errors, paths or content. Only one
// bounded raw nonblocking write is attempted; EAGAIN/partial/unsupported drops
// the line. The process still exits nonzero and the parent rejects completion.
func writeDiagnostic(reason string) {
	switch reason {
	case "admission", "input-protocol", "compiler", "deadline", "output-limit",
		"transport", "internal", "failed":
	default:
		return
	}
	line := []byte("anonymous-normalization:" + reason + "\n")
	if len(line) > 64 {
		return
	}
	raw, err := os.Stderr.SyscallConn()
	if err != nil {
		return
	}
	_ = raw.Control(func(fd uintptr) {
		number := int(fd)
		if admitDescriptor(number) != nil {
			return
		}
		flags, err := descriptorFlags(number, syscall.F_GETFL, 0)
		if err != nil || flags&syscall.O_ACCMODE == syscall.O_RDONLY {
			return
		}
		duplicate, err := descriptorFlags(number, syscall.F_DUPFD_CLOEXEC, 3)
		if err != nil {
			return
		}
		defer syscall.Close(duplicate)
		if syscall.SetNonblock(duplicate, true) != nil {
			return
		}
		defer func() { _, _ = descriptorFlags(number, syscall.F_SETFL, flags) }()
		// No Go blocking wrapper, retry, shell, file/TTY write or waiting.
		_, _ = syscall.Write(duplicate, line)
	})
}
