package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"io"
)

const (
	protocol  = "cloudmarkup.anonymous-normalization.v1"
	magic     = "CMNORM1\n"
	maxInput  = 1024 * 1024
	maxOutput = 2 * 1024 * 1024
	maxStderr = 64 * 1024
)

var (
	errProtocol  = errors.New("input-protocol")
	errAdmission = errors.New("admission")
	errCompiler  = errors.New("compiler")
	errDeadline  = errors.New("deadline")
	errOutput    = errors.New("output-limit")
	errTransport = errors.New("transport")
)

type inputFrame struct {
	bytes  []byte
	digest string
}

func readFrames(reader io.Reader) (frames [3]inputFrame, err error) {
	defer func() {
		if err != nil {
			clearFrames(&frames)
		}
	}()
	header := make([]byte, len(magic))
	if _, err = io.ReadFull(reader, header); err != nil || string(header) != magic {
		return frames, errProtocol
	}
	for index := range frames {
		var length [4]byte
		var expected [sha256.Size]byte
		if _, err = io.ReadFull(reader, length[:]); err != nil {
			return frames, errProtocol
		}
		size := binary.BigEndian.Uint32(length[:])
		if size == 0 || size > maxInput {
			return frames, errProtocol
		}
		if _, err = io.ReadFull(reader, expected[:]); err != nil {
			return frames, errProtocol
		}
		frames[index].bytes = make([]byte, int(size))
		if _, err = io.ReadFull(reader, frames[index].bytes); err != nil {
			return frames, errProtocol
		}
		actual := sha256.Sum256(frames[index].bytes)
		if !bytes.Equal(actual[:], expected[:]) {
			return frames, errProtocol
		}
		frames[index].digest = hex.EncodeToString(actual[:])
	}
	var trailing [1]byte
	count, finalError := reader.Read(trailing[:])
	if count != 0 || finalError != io.EOF {
		return frames, errProtocol
	}
	return frames, nil
}

func clearFrames(frames *[3]inputFrame) {
	for index := range frames {
		clear(frames[index].bytes)
		frames[index] = inputFrame{}
	}
}

// Closed write loop shared by the bounded transport and its source tests.
func writeAll(writer io.Writer, value []byte) error {
	for len(value) > 0 {
		count, err := writer.Write(value)
		if count < 0 || count > len(value) {
			return errTransport
		}
		value = value[count:]
		if err != nil {
			return errTransport
		}
		if count == 0 {
			return errTransport
		}
	}
	return nil
}
