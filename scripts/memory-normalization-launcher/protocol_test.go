package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"io"
	"testing"
)

func encodedFrames(values [3][]byte) []byte {
	var wire bytes.Buffer
	wire.WriteString(magic)
	for _, value := range values {
		var length [4]byte
		binary.BigEndian.PutUint32(length[:], uint32(len(value)))
		sum := sha256.Sum256(value)
		wire.Write(length[:])
		wire.Write(sum[:])
		wire.Write(value)
	}
	return wire.Bytes()
}

func TestExactlyThreeBoundedDigestBoundFrames(t *testing.T) {
	values := [3][]byte{[]byte("{}"), []byte("{\"workload\":1}"), []byte("{\"revision\":1}")}
	wire := encodedFrames(values)
	frames, err := readFrames(bytes.NewReader(wire))
	if err != nil {
		t.Fatal(err)
	}
	defer clearFrames(&frames)
	for index, expected := range values {
		if !bytes.Equal(frames[index].bytes, expected) || len(frames[index].digest) != 64 {
			t.Fatal("frame identity was not retained")
		}
	}
	large := [3][]byte{bytes.Repeat([]byte("a"), maxInput), bytes.Repeat([]byte("b"), maxInput), bytes.Repeat([]byte("c"), maxInput)}
	frames, err = readFrames(bytes.NewReader(encodedFrames(large)))
	if err != nil {
		t.Fatal("exact input limit rejected")
	}
	clearFrames(&frames)
}

func TestMalformedOrExtraFramesNeverContinue(t *testing.T) {
	valid := encodedFrames([3][]byte{[]byte("{}"), []byte("{}"), []byte("{}")})
	badDigest := append([]byte(nil), valid...)
	badDigest[len(magic)+4] ^= 1
	oversize := append([]byte(nil), valid...)
	binary.BigEndian.PutUint32(oversize[len(magic):len(magic)+4], maxInput+1)
	zero := append([]byte(nil), valid...)
	binary.BigEndian.PutUint32(zero[len(magic):len(magic)+4], 0)
	for name, value := range map[string][]byte{
		"empty": nil, "magic": []byte("OTHER1\n"), "truncated-length": valid[:len(magic)+3],
		"truncated-digest": valid[:len(magic)+10], "truncated-payload": valid[:len(valid)-1],
		"trailing": append(append([]byte(nil), valid...), 0), "digest": badDigest,
		"oversize": oversize, "zero": zero,
	} {
		t.Run(name, func(t *testing.T) {
			frames, err := readFrames(bytes.NewReader(value))
			if !errors.Is(err, errProtocol) {
				t.Fatal("malformed input accepted")
			}
			for _, frame := range frames {
				if len(frame.bytes) != 0 || frame.digest != "" {
					t.Fatal("failed input retained")
				}
			}
		})
	}
}

type noProgressWriter struct{}

func (noProgressWriter) Write([]byte) (int, error) { return 0, nil }

func TestWriteFailureIsClosed(t *testing.T) {
	if !errors.Is(writeAll(noProgressWriter{}, []byte("public")), errTransport) {
		t.Fatal("no-progress writer accepted")
	}
	if err := writeAll(io.Discard, []byte("public")); err != nil {
		t.Fatal(err)
	}
}
