package compiler

import (
	"fmt"
	"sort"
	"strings"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclwrite"
	"github.com/zclconf/go-cty/cty"
)

func (renderer *terraformRenderer) renderVersions() {
	block := hclwrite.NewBlock("terraform", nil)
	block.Body().SetAttributeValue("required_version", cty.StringVal(TerraformRequiredVersion))
	required := hclwrite.NewBlock("required_providers", nil)
	providerVersion := TerraformAWSProviderVersion
	if isCurrentAwsCatalog(renderer.model.Provenance.Catalog) {
		providerVersion = ">= 6.63.0, < 7.0.0"
	}
	required.Body().SetAttributeRaw("aws", hclwrite.TokensForObject([]hclwrite.ObjectAttrTokens{
		{Name: hclwrite.TokensForIdentifier("source"), Value: hclwrite.TokensForValue(cty.StringVal(TerraformAWSProviderSource))},
		{Name: hclwrite.TokensForIdentifier("version"), Value: hclwrite.TokensForValue(cty.StringVal(providerVersion))},
	}))
	block.Body().AppendBlock(required)
	appendBlock(renderer.file("versions.tf"), block)
}

func (renderer *terraformRenderer) renderProviders() {
	region := cty.StringVal(renderer.modelRegion())
	renderer.addVariable(terraformVariable{
		Name: "aws_region", Type: "string", Required: false, Default: &region,
		Description: "AWS Region selected by the immutable Architecture Document.",
	})
	provider := hclwrite.NewBlock("provider", []string{"aws"})
	provider.Body().SetAttributeTraversal("region", traversal("var", "aws_region"))
	defaultTags := hclwrite.NewBlock("default_tags", nil)
	defaultTags.Body().SetAttributeTraversal("tags", traversal("local", "tags"))
	provider.Body().AppendBlock(defaultTags)
	appendBlock(renderer.file("providers.tf"), provider)

	for _, variable := range renderer.model.Variables {
		kind := terraformVariableType(variable.ValueType)
		if kind == "" {
			renderer.error("TARGET_VARIABLE_TYPE_UNSUPPORTED", "Architecture variable type is unsupported by Terraform generation.", SourceReference{Document: DocumentArchitecture, Path: "$.variables", NodeID: variable.ID})
			continue
		}
		declaration := terraformVariable{
			Name: terraformIdentifier(variable.Key), Type: kind, Required: variable.Required,
			Description: "Architecture variable " + variable.Key + ".",
		}
		if variable.DefaultValue != nil {
			if value, ok := configurationValueToCty(*variable.DefaultValue); ok {
				declaration.Default = &value
				declaration.Required = false
			} else {
				renderer.error("TARGET_VARIABLE_DEFAULT_UNSUPPORTED", "Architecture variable default cannot be represented safely.", SourceReference{Document: DocumentArchitecture, Path: "$.variables", NodeID: variable.ID})
			}
		}
		renderer.addVariable(declaration)
	}
}

func (renderer *terraformRenderer) modelRegion() string {
	return renderer.model.Provenance.Region
}

func (renderer *terraformRenderer) renderLocals() {
	tags := map[string]cty.Value{
		"CloudMarkupArchitecture": cty.StringVal(renderer.model.Provenance.ArchitectureID),
		"CloudMarkupRevision":     cty.StringVal(renderer.model.Provenance.ArchitectureRevisionID),
		"ManagedBy":               cty.StringVal("CloudMarkup"),
	}
	if renderer.model.Provenance.SolutionRevisionID != "" {
		tags["CloudMarkupSolutionRevision"] = cty.StringVal(renderer.model.Provenance.SolutionRevisionID)
	}
	block := hclwrite.NewBlock("locals", nil)
	block.Body().SetAttributeValue("tags", cty.MapVal(tags))
	appendBlock(renderer.file("locals.tf"), block)
}

func (renderer *terraformRenderer) addVariable(variable terraformVariable) {
	if existing, exists := renderer.variables[variable.Name]; exists {
		if existing.Type != variable.Type || existing.Required != variable.Required || existing.Sensitive != variable.Sensitive || existing.Validation != variable.Validation {
			renderer.error("TARGET_VARIABLE_COLLISION", "Two compiler inputs require incompatible Terraform variables.", SourceReference{Document: DocumentArchitecture})
		}
		return
	}
	renderer.variables[variable.Name] = variable
	if variable.Required {
		renderer.exampleValues[variable.Name] = placeholderForVariable(variable)
	}
}

func (renderer *terraformRenderer) renderVariables() {
	names := make([]string, 0, len(renderer.variables))
	for name := range renderer.variables {
		names = append(names, name)
	}
	sort.Slice(names, func(left int, right int) bool { return compareUTF16(names[left], names[right]) < 0 })
	file := renderer.file("variables.tf")
	for _, name := range names {
		variable := renderer.variables[name]
		block := hclwrite.NewBlock("variable", []string{name})
		block.Body().SetAttributeRaw("type", terraformTypeTokens(variable.Type))
		block.Body().SetAttributeValue("description", cty.StringVal(variable.Description))
		if variable.Sensitive {
			block.Body().SetAttributeValue("sensitive", cty.BoolVal(true))
		}
		if variable.Default != nil {
			block.Body().SetAttributeValue("default", *variable.Default)
		}
		if variable.Validation != "" {
			validation := hclwrite.NewBlock("validation", nil)
			validation.Body().SetAttributeRaw("condition", terraformVariableValidationTokens(variable.Name, variable.Validation))
			validation.Body().SetAttributeValue("error_message", cty.StringVal(terraformVariableValidationMessage(variable.Validation)))
			block.Body().AppendBlock(validation)
		}
		appendBlock(file, block)
	}

	example := renderer.file("terraform.tfvars.example")
	exampleNames := make([]string, 0, len(renderer.exampleValues))
	for name := range renderer.exampleValues {
		exampleNames = append(exampleNames, name)
	}
	sort.Slice(exampleNames, func(left int, right int) bool { return compareUTF16(exampleNames[left], exampleNames[right]) < 0 })
	for _, name := range exampleNames {
		example.Body().SetAttributeValue(name, renderer.exampleValues[name])
	}
}

func terraformVariableType(value string) string {
	switch value {
	case "string":
		return "string"
	case "integer", "number":
		return "number"
	case "boolean":
		return "bool"
	case "string-list":
		return "list(string)"
	case "number-list":
		return "list(number)"
	default:
		return ""
	}
}

func terraformVariableValidationTokens(name string, validation string) hclwrite.Tokens {
	pattern := map[string]string{
		"relative-package-path": `^\.\.?/`,
		"base64-sha256":         `^[A-Za-z0-9+/]{43}=$`,
		"non-empty":             `^.+$`,
	}[validation]
	return hclwrite.TokensForFunctionCall("can", hclwrite.TokensForFunctionCall(
		"regex",
		hclwrite.TokensForValue(cty.StringVal(pattern)),
		hclwrite.TokensForTraversal(traversal("var", name)),
	))
}

func terraformVariableValidationMessage(validation string) string {
	switch validation {
	case "relative-package-path":
		return "Package path must be repository-relative and begin with ./ or ../; absolute machine paths are forbidden."
	case "base64-sha256":
		return "Package digest must be one base64-encoded SHA-256 value."
	default:
		return "Artifact input must be non-empty."
	}
}
func terraformTypeTokens(value string) hclwrite.Tokens {
	if value == "list(string)" || value == "list(number)" {
		elementType := strings.TrimSuffix(strings.TrimPrefix(value, "list("), ")")
		return hclwrite.TokensForFunctionCall("list", hclwrite.TokensForIdentifier(elementType))
	}
	return hclwrite.TokensForIdentifier(value)
}

func configurationValueToCty(value ConfigurationValue) (cty.Value, bool) {
	switch value.Kind {
	case "string":
		typed, ok := value.Value.(string)
		if !ok {
			return cty.NilVal, false
		}
		return cty.StringVal(typed), true
	case "boolean":
		typed, ok := value.Value.(bool)
		if !ok {
			return cty.NilVal, false
		}
		return cty.BoolVal(typed), true
	case "number", "integer":
		typed, ok := value.Value.(float64)
		if !ok {
			return cty.NilVal, false
		}
		return cty.NumberFloatVal(typed), true
	case "string-list":
		items, ok := value.Value.([]any)
		if !ok || len(items) == 0 {
			return cty.NilVal, false
		}
		values := make([]cty.Value, 0, len(items))
		for _, item := range items {
			text, ok := item.(string)
			if !ok {
				return cty.NilVal, false
			}
			values = append(values, cty.StringVal(text))
		}
		return cty.ListVal(values), true
	case "number-list":
		items, ok := value.Value.([]any)
		if !ok || len(items) == 0 {
			return cty.NilVal, false
		}
		values := make([]cty.Value, 0, len(items))
		for _, item := range items {
			number, ok := item.(float64)
			if !ok {
				return cty.NilVal, false
			}
			values = append(values, cty.NumberFloatVal(number))
		}
		return cty.ListVal(values), true
	default:
		return cty.NilVal, false
	}
}

func placeholderForVariable(variable terraformVariable) cty.Value {
	if variable.Sensitive {
		return cty.StringVal("REPLACE_WITH_SECURE_VALUE")
	}
	switch variable.Type {
	case "number":
		return cty.NumberIntVal(0)
	case "bool":
		return cty.BoolVal(false)
	case "list(string)":
		return cty.ListVal([]cty.Value{cty.StringVal("REPLACE_ME")})
	case "list(number)":
		return cty.ListVal([]cty.Value{cty.NumberIntVal(0)})
	default:
		return cty.StringVal("REPLACE_ME")
	}
}

func (renderer *terraformRenderer) renderOutputs() {
	file := renderer.file("outputs.tf")
	for _, output := range renderer.model.Outputs {
		block := hclwrite.NewBlock("output", []string{terraformIdentifier(output.Key)})
		block.Body().SetAttributeValue("description", cty.StringVal("Architecture output "+output.Key+"."))
		if output.Sensitive {
			block.Body().SetAttributeValue("sensitive", cty.BoolVal(true))
		}
		switch output.Kind {
		case "node-attribute":
			if output.Resource == nil {
				renderer.error("TARGET_OUTPUT_REFERENCE_INVALID", "Architecture output has no resource reference.", SourceReference{Document: DocumentArchitecture, Path: "$.outputs"})
				continue
			}
			block.Body().SetAttributeRaw("value", renderer.resourceAttributeTokens(output.Resource.NodeID, output.Resource.Attribute))
		case "variable":
			name, ok := renderer.variableNameByID(output.VariableID)
			if !ok {
				renderer.error("TARGET_OUTPUT_REFERENCE_INVALID", "Architecture output references an unavailable variable.", SourceReference{Document: DocumentArchitecture, Path: "$.outputs"})
				continue
			}
			block.Body().SetAttributeTraversal("value", traversal("var", name))
		default:
			renderer.error("TARGET_OUTPUT_KIND_UNSUPPORTED", "Architecture output kind is unsupported by Terraform generation.", SourceReference{Document: DocumentArchitecture, Path: "$.outputs"})
			continue
		}
		appendBlock(file, block)
	}
}

func (renderer *terraformRenderer) variableNameByID(id string) (string, bool) {
	for _, variable := range renderer.model.Variables {
		if variable.ID == id {
			return terraformIdentifier(variable.Key), true
		}
	}
	return "", false
}

func (renderer *terraformRenderer) renderReadme() string {
	var result strings.Builder
	result.WriteString("# Cloud Markup deterministic Terraform\n\n")
	result.WriteString("This directory was generated from immutable Architecture and Workload contracts. It does not build application source, run Terraform, or deploy.\n\n")
	result.WriteString("## Compatibility\n\n")
	fmt.Fprintf(&result, "- Compiler: `%s@%s`\n", CompilerID, CompilerVersion)
	fmt.Fprintf(&result, "- Catalog: `%s@%s` (`%s`)\n", renderer.model.Provenance.Catalog.ID, renderer.model.Provenance.Catalog.Version, renderer.model.Provenance.Catalog.Digest)
	fmt.Fprintf(&result, "- Target format: `%s`\n", TerraformFormatVersion)
	fmt.Fprintf(&result, "- Terraform: `%s`\n", TerraformRequiredVersion)
	fmt.Fprintf(&result, "- AWS provider: `%s` (`%s`)\n", TerraformAWSProviderSource, TerraformAWSProviderVersion)
	fmt.Fprintf(&result, "- Architecture revision: `%s`\n", renderer.model.Provenance.ArchitectureRevisionID)
	if renderer.model.Provenance.SolutionRevisionID != "" {
		fmt.Fprintf(&result, "- Solution Revision: `%s`\n", renderer.model.Provenance.SolutionRevisionID)
	}
	result.WriteString("\n## Application artifacts\n\n")
	for _, artifact := range renderer.applicationArtifacts {
		fmt.Fprintf(&result, "- `%s` (%s): %s", artifact.WorkloadID, artifact.ImplementationMode, artifact.Delivery)
		if artifact.RelativePackagePath != "" {
			fmt.Fprintf(&result, " at `%s`", artifact.RelativePackagePath)
		}
		result.WriteString(".\n")
		if artifact.CodeRequired {
			result.WriteString("  Application code and a validated package are required before plan or deployment.\n")
		}
	}
	result.WriteString("\nCopy `terraform.tfvars.example` to a separately protected input file and replace every placeholder. Never put credentials or secret values in committed Terraform files. Review the complete diff, initialize from an approved provider mirror, validate, plan, and deploy only in customer-owned CI/CD with customer approval.\n")
	return result.String()
}

func appendBlock(file *hclwrite.File, block *hclwrite.Block) {
	body := file.Body()
	if len(body.Blocks()) > 0 || len(body.Attributes()) > 0 {
		body.AppendNewline()
	}
	body.AppendBlock(block)
}

func traversal(root string, attributes ...string) hcl.Traversal {
	result := hcl.Traversal{hcl.TraverseRoot{Name: root}}
	for _, attribute := range attributes {
		result = append(result, hcl.TraverseAttr{Name: attribute})
	}
	return result
}
