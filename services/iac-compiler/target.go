package compiler

import "context"

// A diagnostic budget may discard detail, but must never turn a failed render
// into a successful artifact. Preserve the first error even if warnings filled
// the budget before resource rendering reached it.
func retainTargetDiagnostic(diagnostics []Diagnostic, limit int, incoming Diagnostic) []Diagnostic {
	if limit < 1 {
		limit = 1
	}
	if len(diagnostics) < limit {
		return append(diagnostics, incoming)
	}
	if incoming.Severity == SeverityError && !hasErrorDiagnostics(diagnostics) {
		diagnostics[len(diagnostics)-1] = incoming
	}
	return diagnostics
}

type cloudFormationTarget struct{}
type terraformFoundationTarget struct{}

func (terraformFoundationTarget) Descriptor() TargetDescriptor {
	return TargetDescriptor{
		Kind:               TargetTerraform,
		ContractVersion:    TerraformTargetContractVersion,
		RenderingAvailable: true,
	}
}

func (terraformFoundationTarget) Assess(ctx context.Context, model *NormalizedSolution) TargetReadiness {
	select {
	case <-ctx.Done():
		return TargetReadiness{
			Target:             TargetTerraform,
			ContractVersion:    TerraformTargetContractVersion,
			State:              "canceled",
			RenderingAvailable: false,
			Reasons:            []string{"COMPILER_CANCELED"},
		}
	default:
	}

	state := "ready"
	reasons := []string{}
	if model == nil {
		state = "invalid"
		reasons = []string{"TARGET_INPUT_INVALID"}
	}
	return TargetReadiness{
		Target:             TargetTerraform,
		ContractVersion:    TerraformTargetContractVersion,
		State:              state,
		RenderingAvailable: model != nil,
		Reasons:            reasons,
	}
}

func (terraformFoundationTarget) Render(ctx context.Context, model *NormalizedSolution, extensions []TargetExtensionReference, limits Limits) (*TargetArtifact, []Diagnostic) {
	return renderTerraformArtifact(ctx, model, extensions, limits)

}
func (cloudFormationTarget) Descriptor() TargetDescriptor {
	return TargetDescriptor{
		Kind:               TargetCloudFormation,
		ContractVersion:    CloudFormationTargetContractVersion,
		RenderingAvailable: true,
	}
}

func (cloudFormationTarget) Assess(ctx context.Context, model *NormalizedSolution) TargetReadiness {
	select {
	case <-ctx.Done():
		return TargetReadiness{
			Target:             TargetCloudFormation,
			ContractVersion:    CloudFormationTargetContractVersion,
			State:              "canceled",
			RenderingAvailable: false,
			Reasons:            []string{"COMPILER_CANCELED"},
		}
	default:
	}

	state := "ready"
	reasons := []string{}
	if model == nil {
		state = "invalid"
		reasons = []string{"TARGET_INPUT_INVALID"}
	}
	return TargetReadiness{
		Target:             TargetCloudFormation,
		ContractVersion:    CloudFormationTargetContractVersion,
		State:              state,
		RenderingAvailable: model != nil,
		Reasons:            reasons,
	}
}

func (cloudFormationTarget) Render(ctx context.Context, model *NormalizedSolution, extensions []TargetExtensionReference, limits Limits) (*TargetArtifact, []Diagnostic) {
	return renderCloudFormationArtifact(ctx, model, extensions, limits)
}

func targetFor(kind TargetKind) (Target, bool) {
	switch kind {
	case "", TargetTerraform:
		return terraformFoundationTarget{}, true
	case TargetCloudFormation:
		return cloudFormationTarget{}, true
	default:
		return nil, false
	}
}
