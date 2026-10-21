package compiler

import (
	"crypto/sha256"
	"fmt"
	"sort"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclsyntax"
)

const TerraformHCLInspectorID = "cloudmarkup.terraform-hcl-inspector"
const TerraformHCLInspectorVersion = "1.0.0"

type HCLSourceRange struct {
	StartLine   int `json:"startLine"`
	StartColumn int `json:"startColumn"`
	EndLine     int `json:"endLine"`
	EndColumn   int `json:"endColumn"`
}

type HCLInspectionDiagnostic struct {
	Code     string         `json:"code"`
	Severity string         `json:"severity"`
	Range    HCLSourceRange `json:"range"`
}

type HCLInspectionAttribute struct {
	Name             string         `json:"name"`
	ExpressionKind   string         `json:"expressionKind"`
	ExpressionDigest string         `json:"expressionDigest"`
	References       []string       `json:"references"`
	Range            HCLSourceRange `json:"range"`
}

type HCLInspectionBlock struct {
	Type       string                   `json:"type"`
	Labels     []string                 `json:"labels"`
	BlockPath  []string                 `json:"blockPath"`
	Range      HCLSourceRange           `json:"range"`
	Attributes []HCLInspectionAttribute `json:"attributes"`
}

type HCLInspectorPin struct {
	ID      string `json:"id"`
	Version string `json:"version"`
}

type TerraformHCLInspectionResult struct {
	ContractVersion int                       `json:"contractVersion"`
	Parser          HCLInspectorPin           `json:"parser"`
	Succeeded       bool                      `json:"succeeded"`
	Diagnostics     []HCLInspectionDiagnostic `json:"diagnostics"`
	Blocks          []HCLInspectionBlock      `json:"blocks"`
}

// InspectTerraformHCL parses Terraform HCL without evaluating expressions or
// returning source values. It is a data-only boundary for repository import.
func InspectTerraformHCL(source []byte, sourceName string) TerraformHCLInspectionResult {
	result := TerraformHCLInspectionResult{
		ContractVersion: 1,
		Parser:          HCLInspectorPin{ID: TerraformHCLInspectorID, Version: TerraformHCLInspectorVersion},
		Diagnostics:     []HCLInspectionDiagnostic{},
		Blocks:          []HCLInspectionBlock{},
	}
	file, diagnostics := hclsyntax.ParseConfig(source, sourceName, hcl.Pos{Line: 1, Column: 1})
	for _, diagnostic := range diagnostics {
		rangeValue := hcl.Range{}
		if diagnostic.Subject != nil {
			rangeValue = *diagnostic.Subject
		}
		severity := "warning"
		if diagnostic.Severity == hcl.DiagError {
			severity = "error"
		}
		result.Diagnostics = append(result.Diagnostics, HCLInspectionDiagnostic{
			Code: "HCL_PARSE_DIAGNOSTIC", Severity: severity, Range: inspectionRange(rangeValue),
		})
	}
	if file != nil {
		if body, ok := file.Body.(*hclsyntax.Body); ok {
			inspectHCLBody(source, body, nil, &result.Blocks)
		}
	}
	sort.Slice(result.Diagnostics, func(i, j int) bool {
		left, right := result.Diagnostics[i].Range, result.Diagnostics[j].Range
		if left.StartLine != right.StartLine {
			return left.StartLine < right.StartLine
		}
		if left.StartColumn != right.StartColumn {
			return left.StartColumn < right.StartColumn
		}
		return result.Diagnostics[i].Severity < result.Diagnostics[j].Severity
	})
	sort.Slice(result.Blocks, func(i, j int) bool {
		left, right := result.Blocks[i], result.Blocks[j]
		if left.Range.StartLine != right.Range.StartLine {
			return left.Range.StartLine < right.Range.StartLine
		}
		if left.Range.StartColumn != right.Range.StartColumn {
			return left.Range.StartColumn < right.Range.StartColumn
		}
		return fmt.Sprint(left.BlockPath) < fmt.Sprint(right.BlockPath)
	})
	result.Succeeded = !diagnostics.HasErrors()
	return result
}

func inspectHCLBody(source []byte, body *hclsyntax.Body, parentPath []string, blocks *[]HCLInspectionBlock) {
	for _, block := range body.Blocks {
		path := append(append([]string{}, parentPath...), block.Type)
		path = append(path, block.Labels...)
		attributes := make([]HCLInspectionAttribute, 0, len(block.Body.Attributes))
		attributeNames := make([]string, 0, len(block.Body.Attributes))
		for name := range block.Body.Attributes {
			attributeNames = append(attributeNames, name)
		}
		sort.Strings(attributeNames)
		for _, name := range attributeNames {
			attribute := block.Body.Attributes[name]
			rangeValue := attribute.Range()
			expressionRange := attribute.Expr.Range()
			start, end := expressionRange.Start.Byte, expressionRange.End.Byte
			if start < 0 || end < start || end > len(source) {
				start, end = 0, 0
			}
			digest := sha256.Sum256(source[start:end])
			attributes = append(attributes, HCLInspectionAttribute{
				Name:             name,
				ExpressionKind:   hclExpressionKind(attribute.Expr),
				ExpressionDigest: fmt.Sprintf("sha256:%x", digest),
				References:       hclExpressionReferences(attribute.Expr),
				Range:            inspectionRange(rangeValue),
			})
		}
		*blocks = append(*blocks, HCLInspectionBlock{
			Type: block.Type, Labels: append([]string{}, block.Labels...), BlockPath: path,
			Range: inspectionRange(block.Range()), Attributes: attributes,
		})
		inspectHCLBody(source, block.Body, path, blocks)
	}
}

func hclExpressionKind(expression hclsyntax.Expression) string {
	switch expression.(type) {
	case *hclsyntax.LiteralValueExpr:
		return "literal"
	case *hclsyntax.ScopeTraversalExpr, *hclsyntax.RelativeTraversalExpr:
		return "reference"
	case *hclsyntax.TemplateExpr, *hclsyntax.TemplateWrapExpr:
		return "template"
	case *hclsyntax.TupleConsExpr, *hclsyntax.ObjectConsExpr:
		return "collection"
	case *hclsyntax.FunctionCallExpr:
		return "function"
	case *hclsyntax.ConditionalExpr:
		return "conditional"
	case *hclsyntax.ForExpr:
		return "for-expression"
	case *hclsyntax.SplatExpr:
		return "splat"
	case *hclsyntax.IndexExpr:
		return "index"
	case *hclsyntax.UnaryOpExpr, *hclsyntax.BinaryOpExpr:
		return "operator"
	case *hclsyntax.ParenthesesExpr:
		return "parenthesized"
	default:
		return "unknown"
	}
}

func hclExpressionReferences(expression hclsyntax.Expression) []string {
	values := map[string]struct{}{}
	for _, traversal := range expression.Variables() {
		parts := []string{}
		for _, step := range traversal {
			switch typed := step.(type) {
			case hcl.TraverseRoot:
				parts = append(parts, typed.Name)
			case hcl.TraverseAttr:
				parts = append(parts, typed.Name)
			}
		}
		if len(parts) > 0 {
			values[joinReference(parts)] = struct{}{}
		}
	}
	result := make([]string, 0, len(values))
	for value := range values {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func joinReference(parts []string) string {
	result := ""
	for index, part := range parts {
		if index > 0 {
			result += "."
		}
		result += part
	}
	return result
}

func inspectionRange(value hcl.Range) HCLSourceRange {
	return HCLSourceRange{StartLine: max(value.Start.Line, 1), StartColumn: max(value.Start.Column, 1), EndLine: max(value.End.Line, 1), EndColumn: max(value.End.Column, 1)}
}
