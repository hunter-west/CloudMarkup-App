//go:build !linux

package main

import (
	"io"
	"os"
)

func main() {
	_, _ = io.WriteString(os.Stderr, "anonymous-normalization:unsupported-platform\n")
	os.Exit(1)
}
