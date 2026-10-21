package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"

	compiler "cloudmarkup.com/iac-compiler"
)

const usageText = "usage: cloudmarkup-iac <normalize|compile> --architecture <path|-> [--workload <path>] [--solution-revision <path>] [--target terraform|cloudformation] [--output <path|->]\n       cloudmarkup-iac inspect-terraform-hcl --input <path|-> [--output <path|->]"

func runCLI(ctx context.Context, args []string, stdin io.Reader, stdout io.Writer, stderr io.Writer) int {
	if len(args) > 0 && args[0] == "inspect-terraform-hcl" {
		return runTerraformHCLInspector(args[1:], stdin, stdout, stderr)
	}
	if len(args) == 0 || (args[0] != "normalize" && args[0] != "compile") {
		fmt.Fprintln(stderr, usageText)
		return 2
	}
	command := args[0]
	flags := flag.NewFlagSet(command, flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	architecturePath := flags.String("architecture", "", "Architecture Document path or - for stdin")
	workloadPath := flags.String("workload", "", "optional Workload Document path")
	solutionPath := flags.String("solution-revision", "", "optional Solution Revision path")
	targetValue := flags.String("target", string(compiler.TargetTerraform), "compiler target")
	outputPath := flags.String("output", "-", "result path or - for stdout")
	maximumInputBytes := flags.Int64("max-input-bytes", compiler.DefaultLimits().MaxArchitectureBytes, "maximum bytes per input")
	maximumOutputBytes := flags.Int("max-output-bytes", compiler.DefaultLimits().MaxArtifactBytes, "maximum result bytes")
	if err := flags.Parse(args[1:]); err != nil || flags.NArg() != 0 || *architecturePath == "" || *maximumInputBytes <= 0 || *maximumOutputBytes <= 0 {
		fmt.Fprintln(stderr, usageText)
		return 2
	}
	if outputOverwritesInput(*outputPath, []string{*architecturePath, *workloadPath, *solutionPath}) {
		fmt.Fprintln(stderr, "cloudmarkup-iac: output must not overwrite an input document")
		return 2
	}

	architecture, closeArchitecture, err := openInput(*architecturePath, stdin, true)
	if err != nil {
		fmt.Fprintln(stderr, "cloudmarkup-iac: could not open Architecture Document")
		return 1
	}
	defer closeArchitecture()
	workload, closeWorkload, err := openInput(*workloadPath, stdin, false)
	if err != nil {
		fmt.Fprintln(stderr, "cloudmarkup-iac: could not open Workload Document")
		return 1
	}
	defer closeWorkload()
	solution, closeSolution, err := openInput(*solutionPath, stdin, false)
	if err != nil {
		fmt.Fprintln(stderr, "cloudmarkup-iac: could not open Solution Revision")
		return 1
	}
	defer closeSolution()

	limits := compiler.DefaultLimits()
	limits.MaxArchitectureBytes = *maximumInputBytes
	limits.MaxWorkloadBytes = *maximumInputBytes
	limits.MaxSolutionBytes = *maximumInputBytes
	limits.MaxNormalizedBytes = *maximumOutputBytes
	limits.MaxArtifactBytes = *maximumOutputBytes
	readerRequest := compiler.ReaderRequest{
		Architecture: architecture, Workload: workload, SolutionRevision: solution,
		Target: compiler.TargetKind(*targetValue), Compatibility: compiler.DefaultCompatibilityRegistry(), Limits: limits,
	}
	var result any
	succeeded := false
	if command == "compile" {
		compiled := compiler.CompileReaders(ctx, compiler.CompileReaderRequest{Request: readerRequest})
		result = compiled
		succeeded = compiled.Succeeded()
	} else {
		normalized := compiler.NormalizeReaders(ctx, readerRequest)
		result = normalized
		succeeded = normalized.Succeeded()
	}

	output, closeOutput, err := openOutput(*outputPath, stdout)
	if err != nil {
		fmt.Fprintln(stderr, "cloudmarkup-iac: could not open output")
		return 1
	}
	defer closeOutput()
	encoder := json.NewEncoder(output)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(result); err != nil {
		fmt.Fprintln(stderr, "cloudmarkup-iac: could not write result")
		return 1
	}
	if !succeeded {
		return 2
	}
	return 0
}

func runTerraformHCLInspector(args []string, stdin io.Reader, stdout io.Writer, stderr io.Writer) int {
	flags := flag.NewFlagSet("inspect-terraform-hcl", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	inputPath := flags.String("input", "", "Terraform HCL path or - for stdin")
	outputPath := flags.String("output", "-", "inspection result path or - for stdout")
	maximumInputBytes := flags.Int64("max-input-bytes", 8*1024*1024, "maximum input bytes")
	maximumOutputBytes := flags.Int("max-output-bytes", 8*1024*1024, "maximum output bytes")
	if err := flags.Parse(args); err != nil || flags.NArg() != 0 || *inputPath == "" || *maximumInputBytes <= 0 || *maximumOutputBytes <= 0 {
		fmt.Fprintln(stderr, usageText)
		return 2
	}
	if outputOverwritesInput(*outputPath, []string{*inputPath}) {
		fmt.Fprintln(stderr, "cloudmarkup-iac: output must not overwrite an input document")
		return 2
	}
	input, closeInput, err := openInput(*inputPath, stdin, true)
	if err != nil {
		fmt.Fprintln(stderr, "cloudmarkup-iac: could not open Terraform HCL input")
		return 1
	}
	defer closeInput()
	limited := io.LimitReader(input, *maximumInputBytes+1)
	source, err := io.ReadAll(limited)
	if err != nil || int64(len(source)) > *maximumInputBytes {
		fmt.Fprintln(stderr, "cloudmarkup-iac: Terraform HCL input exceeds the approved limit")
		return 1
	}
	result := compiler.InspectTerraformHCL(source, "repository.tf")
	encoded, err := json.MarshalIndent(result, "", "  ")
	if err != nil || len(encoded)+1 > *maximumOutputBytes {
		fmt.Fprintln(stderr, "cloudmarkup-iac: inspection output exceeds the approved limit")
		return 1
	}
	output, closeOutput, err := openOutput(*outputPath, stdout)
	if err != nil {
		fmt.Fprintln(stderr, "cloudmarkup-iac: could not open output")
		return 1
	}
	defer closeOutput()
	if _, err := output.Write(append(encoded, '\n')); err != nil {
		fmt.Fprintln(stderr, "cloudmarkup-iac: could not write result")
		return 1
	}
	if !result.Succeeded {
		return 2
	}
	return 0
}

func openInput(path string, stdin io.Reader, required bool) (io.Reader, func(), error) {
	if path == "" {
		if required {
			return nil, func() {}, fmt.Errorf("input path is required")
		}
		return nil, func() {}, nil
	}
	if path == "-" {
		return stdin, func() {}, nil
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, func() {}, err
	}
	return file, func() { _ = file.Close() }, nil
}

func openOutput(path string, stdout io.Writer) (io.Writer, func(), error) {
	if path == "-" {
		return stdout, func() {}, nil
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, func() {}, err
	}
	return file, func() { _ = file.Close() }, nil
}

func outputOverwritesInput(output string, inputs []string) bool {
	if output == "-" {
		return false
	}
	outputAbsolute, err := filepath.Abs(output)
	if err != nil {
		return true
	}
	for _, input := range inputs {
		if input == "" || input == "-" {
			continue
		}
		inputAbsolute, err := filepath.Abs(input)
		if err != nil || filepath.Clean(inputAbsolute) == filepath.Clean(outputAbsolute) {
			return true
		}
	}
	return false
}
