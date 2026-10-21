package compiler

import "context"

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
