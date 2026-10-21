//go:build linux

package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
)

const maxExecutable = 128 * 1024 * 1024
const readOnlyFilesystemFlag = 1 // Linux ST_RDONLY, returned by fstatfs.

var digestPattern = regexp.MustCompile("^[a-f0-9]{64}$")
var bootPattern = regexp.MustCompile("^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$")

type hostSnapshot struct {
	kernel      string
	boot        string
	swaps       string
	corePattern string
	coreLimit   uint64
}

func smallRead(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", errAdmission
	}
	defer file.Close()
	value, err := io.ReadAll(io.LimitReader(file, 16*1024+1))
	if err != nil || len(value) > 16*1024 {
		return "", errAdmission
	}
	return string(value), nil
}

func snapshot() (hostSnapshot, error) {
	var value hostSnapshot
	var err error
	if value.kernel, err = smallRead("/proc/sys/kernel/osrelease"); err != nil {
		return value, err
	}
	if value.boot, err = smallRead("/proc/sys/kernel/random/boot_id"); err != nil {
		return value, err
	}
	if value.swaps, err = smallRead("/proc/swaps"); err != nil {
		return value, err
	}
	if value.corePattern, err = smallRead("/proc/sys/kernel/core_pattern"); err != nil {
		return value, err
	}
	var limit syscall.Rlimit
	if syscall.Getrlimit(syscall.RLIMIT_CORE, &limit) != nil {
		return value, errAdmission
	}
	value.coreLimit = limit.Cur
	return value, nil
}

func admitSnapshot(value hostSnapshot) error {
	kernel := strings.ToLower(value.kernel)
	if strings.TrimSpace(kernel) == "" || strings.Contains(kernel, "microsoft") ||
		strings.Contains(kernel, "wsl") || strings.Contains(kernel, "linuxkit") {
		return errAdmission
	}
	if !bootPattern.MatchString(strings.TrimSpace(value.boot)) || value.coreLimit != 0 {
		return errAdmission
	}
	switch value.corePattern {
	case "core", "core\n", "core.%p", "core.%p\n":
	default:
		return errAdmission
	}
	// An empty list with the exact procfs column names admits no active swap.
	if strings.Join(strings.Fields(value.swaps), " ") != "Filename Type Size Used Priority" {
		return errAdmission
	}
	return nil
}

func admitHost() (hostSnapshot, error) {
	value, err := snapshot()
	if err != nil {
		return value, err
	}
	return value, admitSnapshot(value)
}

// The parent must separately establish its trusted network-none namespace,
// credentialless execution and no memory capture. This launcher does not create
// namespaces or mutate host swap, core policy, mounts or daemon settings.
func openCompiler(ctx context.Context, path, expected string) (*os.File, error) {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path || !digestPattern.MatchString(expected) {
		return nil, errAdmission
	}
	fd, err := syscall.Open(path, syscall.O_RDONLY|syscall.O_CLOEXEC|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, errAdmission
	}
	file := os.NewFile(uintptr(fd), "trusted-compiler")
	ok := false
	defer func() {
		if !ok {
			file.Close()
		}
	}()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0111 == 0 ||
		info.Size() <= 0 || info.Size() > maxExecutable {
		return nil, errAdmission
	}
	var filesystem syscall.Statfs_t
	if syscall.Fstatfs(fd, &filesystem) != nil || filesystem.Flags&readOnlyFilesystemFlag == 0 {
		return nil, errAdmission
	}
	hash := sha256.New()
	buffer := make([]byte, 64*1024)
	defer clear(buffer)
	for {
		if ctx.Err() != nil {
			return nil, errDeadline
		}
		count, readError := file.Read(buffer)
		if count > 0 {
			_, _ = hash.Write(buffer[:count])
		}
		if readError == io.EOF {
			break
		}
		if readError != nil {
			return nil, errAdmission
		}
	}
	if hex.EncodeToString(hash.Sum(nil)) != expected {
		return nil, errAdmission
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return nil, errAdmission
	}
	ok = true
	return file, nil
}

var anonymousPipePattern = regexp.MustCompile("^pipe:\\[[0-9]+\\]$")
