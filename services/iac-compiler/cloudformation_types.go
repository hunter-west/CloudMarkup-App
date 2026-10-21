package compiler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"unicode"
)

const (
	cloudFormationTemplatePath   = "infrastructure/template.json"
	cloudFormationParametersPath = "infrastructure/parameters.example.json"
	cloudFormationReadmePath     = "infrastructure/README.md"
)

type cloudFormationTemplate struct {
	AWSTemplateFormatVersion string                             `json:"AWSTemplateFormatVersion"`
	Description              string                             `json:"Description"`
	Metadata                 map[string]any                     `json:"Metadata"`
	Parameters               map[string]cloudFormationParameter `json:"Parameters,omitempty"`
	Resources                map[string]cloudFormationResource  `json:"Resources"`
	Outputs                  map[string]cloudFormationOutput    `json:"Outputs,omitempty"`
}

type cloudFormationParameter struct {
	Type           string `json:"Type"`
	Description    string `json:"Description"`
	Default        any    `json:"Default,omitempty"`
	NoEcho         bool   `json:"NoEcho,omitempty"`
	AllowedPattern string `json:"AllowedPattern,omitempty"`
	MinLength      int    `json:"MinLength,omitempty"`
}

type cloudFormationResource struct {
	Type                string         `json:"Type"`
	Properties          map[string]any `json:"Properties"`
	Metadata            map[string]any `json:"Metadata,omitempty"`
	DependsOn           []string       `json:"DependsOn,omitempty"`
	DeletionPolicy      string         `json:"DeletionPolicy,omitempty"`
	UpdateReplacePolicy string         `json:"UpdateReplacePolicy,omitempty"`
}

type cloudFormationOutput struct {
	Description string `json:"Description"`
	Value       any    `json:"Value"`
}

type cloudFormationParameterBinding struct {
	Name        string
	Example     any
	Description string
	Sensitive   bool
	Validation  string
}

func cloudFormationRef(logicalID string) map[string]any {
	return map[string]any{"Ref": logicalID}
}

func cloudFormationGetAtt(logicalID string, attribute string) map[string]any {
	return map[string]any{"Fn::GetAtt": []any{logicalID, attribute}}
}

func cloudFormationJoin(values ...any) map[string]any {
	return map[string]any{"Fn::Join": []any{"", values}}
}

func cloudFormationSub(template string, variables map[string]any) map[string]any {
	if len(variables) == 0 {
		return map[string]any{"Fn::Sub": template}
	}
	return map[string]any{"Fn::Sub": []any{template, variables}}
}

func deterministicIndentedJSON(value any) ([]byte, error) {
	var output bytes.Buffer
	encoder := json.NewEncoder(&output)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(value); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}

func cloudFormationIdentifier(value string) string {
	var result strings.Builder
	capitalize := true
	for _, character := range value {
		if !unicode.IsLetter(character) && !unicode.IsDigit(character) {
			capitalize = true
			continue
		}
		if capitalize && unicode.IsLetter(character) {
			character = unicode.ToUpper(character)
		}
		result.WriteRune(character)
		capitalize = false
	}
	identifier := result.String()
	if identifier == "" || !unicode.IsLetter([]rune(identifier)[0]) {
		identifier = "Resource" + identifier
	}
	if len(identifier) > 220 {
		identifier = identifier[:208] + strings.ToUpper(shortDigest(value))
	}
	return identifier
}

func cloudFormationParameterPattern(validation string) string {
	switch validation {
	case "base64-sha256":
		return "^[A-Za-z0-9+/]{43}=$"
	case "s3-bucket":
		return "^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$"
	case "non-empty":
		return "^.+$"
	default:
		return ""
	}
}

var cloudFormationLogicalIDPattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9]{0,254}$`)

func validateCloudFormationTemplate(content []byte) error {
	var template map[string]any
	if err := json.Unmarshal(content, &template); err != nil {
		return fmt.Errorf("parse template: %w", err)
	}
	if template["AWSTemplateFormatVersion"] != CloudFormationTemplateSpecificationVersion {
		return fmt.Errorf("unexpected template specification version")
	}
	if _, hasTransform := template["Transform"]; hasTransform {
		return fmt.Errorf("template transforms are forbidden")
	}
	resources, ok := template["Resources"].(map[string]any)
	if !ok || len(resources) == 0 {
		return fmt.Errorf("template resources are required")
	}
	allowedTypes := map[string]bool{
		"AWS::EC2::Volume": true, "AWS::EC2::VolumeAttachment": true,
		"AWS::ElasticLoadBalancingV2::LoadBalancer": true, "AWS::ElasticLoadBalancingV2::TargetGroup": true, "AWS::ElasticLoadBalancingV2::Listener": true,
		"AWS::CloudFront::Distribution": true, "AWS::CloudFront::CachePolicy": true, "AWS::CloudFront::OriginAccessControl": true, "AWS::Route53::RecordSet": true,
		"AWS::Route53::HostedZone": true, "AWS::CertificateManager::Certificate": true,
		"AWS::RDS::DBCluster": true, "AWS::RDS::DBClusterParameterGroup": true,
		"AWS::RDS::DBInstance": true, "AWS::RDS::DBSubnetGroup": true, "AWS::RDS::DBParameterGroup": true,
		"AWS::EC2::Instance": true, "AWS::IAM::InstanceProfile": true,
		"AWS::ECR::Repository": true, "AWS::ECS::Cluster": true, "AWS::ECS::TaskDefinition": true, "AWS::ECS::Service": true,
		"AWS::SecretsManager::Secret": true,
		"AWS::KMS::Key":               true,
		"AWS::FSx::FileSystem":        true, "AWS::FSx::StorageVirtualMachine": true, "AWS::FSx::Volume": true, "AWS::FSx::DataRepositoryAssociation": true,
		"AWS::ApiGatewayV2::Api": true, "AWS::ApiGatewayV2::Authorizer": true,
		"AWS::ApiGatewayV2::Integration": true, "AWS::ApiGatewayV2::Route": true,
		"AWS::ApiGatewayV2::Stage": true, "AWS::CloudWatch::Alarm": true,
		"AWS::Cognito::UserPool": true, "AWS::Cognito::UserPoolClient": true,
		"AWS::DynamoDB::Table": true, "AWS::IAM::Role": true,
		"AWS::Lambda::Function": true, "AWS::Lambda::Permission": true,
		"AWS::Logs::LogGroup": true,
		"AWS::EC2::VPC":       true, "AWS::EC2::Subnet": true,
		"AWS::EC2::RouteTable": true, "AWS::EC2::Route": true,
		"AWS::EC2::SubnetRouteTableAssociation": true, "AWS::EC2::InternetGateway": true,
		"AWS::EC2::VPCGatewayAttachment": true, "AWS::EC2::NatGateway": true,
		"AWS::EC2::VPCEndpoint": true, "AWS::EC2::SecurityGroup": true,
		"AWS::WAFv2::WebACL": true, "AWS::WAFv2::WebACLAssociation": true,
		"AWS::EC2::SecurityGroupIngress": true, "AWS::EC2::SecurityGroupEgress": true,
		"AWS::S3::Bucket": true, "AWS::S3::BucketPolicy": true,
		"AWS::SQS::Queue": true, "AWS::SQS::QueuePolicy": true,
		"AWS::SNS::Topic": true, "AWS::SNS::TopicPolicy": true, "AWS::SNS::Subscription": true,
		"AWS::Events::EventBus": true, "AWS::Events::EventBusPolicy": true, "AWS::Events::Rule": true,
		"AWS::Lambda::EventSourceMapping": true, "AWS::StepFunctions::StateMachine": true,
	}
	for logicalID, raw := range resources {
		if !cloudFormationLogicalIDPattern.MatchString(logicalID) {
			return fmt.Errorf("invalid resource logical ID")
		}
		resource, ok := raw.(map[string]any)
		if !ok || !allowedTypes[fmt.Sprint(resource["Type"])] {
			return fmt.Errorf("unsupported resource type")
		}
		if err := validateCloudFormationIntrinsics(resource); err != nil {
			return err
		}
	}
	if parameters, ok := template["Parameters"].(map[string]any); ok {
		for logicalID := range parameters {
			if !cloudFormationLogicalIDPattern.MatchString(logicalID) {
				return fmt.Errorf("invalid parameter logical ID")
			}
		}
	}
	return validateCloudFormationIntrinsics(template)
}

func validateCloudFormationIntrinsics(value any) error {
	allowed := map[string]bool{"Fn::GetAtt": true, "Fn::Join": true, "Fn::Sub": true}
	var walk func(any) error
	walk = func(current any) error {
		switch typed := current.(type) {
		case []any:
			for _, child := range typed {
				if err := walk(child); err != nil {
					return err
				}
			}
		case map[string]any:
			keys := make([]string, 0, len(typed))
			for key := range typed {
				keys = append(keys, key)
			}
			sort.Strings(keys)
			for _, key := range keys {
				if strings.HasPrefix(key, "Fn::") && !allowed[key] {
					return fmt.Errorf("unsupported intrinsic")
				}
				if key == "Ref" {
					if _, ok := typed[key].(string); !ok {
						return fmt.Errorf("invalid Ref")
					}
				}
				if err := walk(typed[key]); err != nil {
					return err
				}
			}
		}
		return nil
	}
	return walk(value)
}
