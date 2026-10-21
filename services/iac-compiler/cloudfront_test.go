package compiler

import (
	"context"
	"encoding/json"
	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclsyntax"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func cloudfrontModel(alias bool) *NormalizedSolution {
	m := dnsModel(false)
	m.Provenance.Catalog = CatalogReference{ID: TerraformCatalogID, Version: CurrentAwsCatalogVersion, Digest: CurrentAwsCatalogDigest}
	bucket := eventResource("origin", "origin", "aws.s3.bucket", map[string]ConfigurationValue{"bucketName": stringValueConfig("cloudmarkup-synthetic-static-origin"), "blockPublicAccess": boolValue(true), "versioningEnabled": boolValue(true), "deletionProtectionEnabled": boolValue(true), "encryption": stringValueConfig("SSE-S3"), "objectOwnership": stringValueConfig("BUCKET_OWNER_ENFORCED")})
	mode := "default"
	if alias {
		mode = "acm-alias"
	}
	dist := eventResource("distribution", "distribution", serviceCloudfrontDistribution, map[string]ConfigurationValue{"comment": stringValueConfig("Synthetic public static delivery"), "enabled": boolValue(false), "publicContentAttested": boolValue(true), "defaultRootObject": stringValueConfig("index.html"), "priceClass": stringValueConfig("PriceClass_100"), "viewerCertificateMode": stringValueConfig(mode), "viewerProtocolPolicy": stringValueConfig("redirect-to-https"), "httpVersion": stringValueConfig("http2"), "ipv6Enabled": boolValue(true), "compress": boolValue(true), "originAccessMode": stringValueConfig("oac-signed-readonly"), "retain": boolValue(true)})
	cache := eventResource("static_cache", "static_cache", serviceCloudfrontCache, map[string]ConfigurationValue{"name": stringValueConfig("StaticExample"), "comment": stringValueConfig("Synthetic bounded static cache"), "minTtl": integerValue(0), "defaultTtl": integerValue(300), "maxTtl": integerValue(3600), "forwardViewerCookies": boolValue(false), "headers": stringValueConfig("none"), "queryStrings": stringValueConfig("none"), "gzip": boolValue(true), "brotli": boolValue(true), "retain": boolValue(true)})
	m.Resources = append(m.Resources, bucket, dist, cache)
	e := networkConnection("cloudfront_origin", cloudfrontOrigin, dist, bucket)
	m.Connections = append(m.Connections, e, networkConnection("cloudfront_cache", cloudfrontCache, dist, cache))
	addPolicy(m, "origin_policy", "resource", bucket, "aws.s3.bucket-owns-resource-policy", []string{"s3:GetObject"}, "service", []string{"cloudfront.amazonaws.com"}, &bucket, true, []string{e.ID})
	generated := Lifecycle{Ownership: "generated", Origin: "connection-rule", Provenance: &GeneratedProvenance{GeneratorKind: "connection-rule", GeneratorID: cloudfrontOrigin, GeneratorVersion: "1.0.0", OperationID: "operation_cloudfront_origin", DependentNodeIDs: []string{}, DependentEdgeIDs: []string{e.ID}}}
	for i := range m.Resources {
		n := &m.Resources[i]
		if n.ID == "origin_policy" {
			n.Parent = &ResourceReference{NodeID: bucket.ID, RelationshipType: "aws.s3.bucket-owns-resource-policy"}
			n.Lifecycle = generated
		}
		if n.ID == "origin_policy_statement" {
			n.Configuration.SchemaVersion = "2.0.0"
			n.Parent = &ResourceReference{NodeID: "origin_policy", RelationshipType: "aws.iam.policy-contains-statement"}
			n.Lifecycle = generated
			n.Configuration.Values["resourceNode"] = ConfigurationValue{Kind: "node-reference", NodeID: bucket.ID, Attribute: "aws.s3.bucket.arn"}
		}
	}
	for i := range m.Connections {
		e := &m.Connections[i]
		if strings.HasPrefix(e.ID, "origin_policy_") {
			e.Lifecycle = generated
			switch e.RelationshipType {
			case "aws.s3.bucket-owns-resource-policy":
				e.Configuration.SchemaID = "aws.s3.bucket-owns-resource-policy.connection"
				e.Source.Port = "aws.iam.policy-document.s3-bucket-resource-policy"
				e.Target.Port = "aws.s3.bucket.resource-policy"
			case "aws.iam.policy-contains-statement":
				e.Source.Port = "aws.iam.policy-statement.policy-document"
				e.Target.Port = "aws.iam.policy-document.statement"
			case "aws.iam.authorizes-s3-bucket":
				e.Source.Port = "aws.iam.policy-statement.s3-resource"
				e.Target.Port = "aws.s3.bucket.policy-resource"
			}
		}
	}
	if alias {
		setResourceValue(m, "certificate", "intendedUse", stringValueConfig("cloudfront-viewer"))
		cert, _ := modelResource(m, "certificate")
		a := eventResource("viewer_alias", "viewer_alias", serviceCloudfrontAlias, map[string]ConfigurationValue{"domainName": stringValueConfig("app.example.test"), "dnsRecords": stringValueConfig("A_AND_AAAA"), "retain": boolValue(true)})
		a.Parent = &ResourceReference{NodeID: dist.ID, RelationshipType: cloudfrontAlias}
		m.Resources = append(m.Resources, a)
		m.Connections = append(m.Connections, networkConnection("cloudfront_alias", cloudfrontAlias, a, dist), networkConnection("cloudfront_certificate", cloudfrontCertificate, a, cert))
	}
	for _, attr := range []string{"id", "arn", "domainName", "hostedZoneId"} {
		ref := reference(dist)
		ref.Attribute = serviceCloudfrontDistribution + "." + attr
		m.Outputs = append(m.Outputs, NormalizedOutput{ID: "distribution_" + attr, Key: "distribution_" + attr, Kind: "node-attribute", Resource: &ref})
	}
	ref := reference(cache)
	ref.Attribute = serviceCloudfrontCache + ".id"
	m.Outputs = append(m.Outputs, NormalizedOutput{ID: "cache_id", Key: "cache_id", Kind: "node-attribute", Resource: &ref})
	sortModel(m)
	return m
}
func TestCloudfrontNativeExports(t *testing.T) {
	for _, alias := range []bool{false, true} {
		for _, target := range []string{"terraform", "cloudformation"} {
			t.Run(target+map[bool]string{false: "-default", true: "-alias"}[alias], func(t *testing.T) {
				m := cloudfrontModel(alias)
				before := cloneNormalized(t, m)
				a, d := kmsArtifact(m, target)
				assertNoTargetErrors(t, d)
				warnings := 0
				for _, diagnostic := range d {
					if diagnostic.Code == "CLOUDFRONT_READINESS_EXTERNAL" && diagnostic.Severity == SeverityWarning && strings.Contains(diagnostic.Message, "OAC protects origin access, not viewers") {
						warnings++
					}
				}
				if warnings != 2 {
					t.Fatal("external viewer/content/cleanup readiness warnings missing")
				}
				if a == nil {
					t.Fatal("missing CloudFront export")
				}
				if !reflect.DeepEqual(m, before) {
					t.Fatal("source mutation")
				}
				file, name := "infrastructure/cloudfront.tf", "cloudfront.tf"
				if target == "cloudformation" {
					file, name = cloudFormationTemplatePath, "template.json"
				}
				content := fileContent(t, a, file)
				for _, bad := range []string{"CustomOriginConfig", "custom_origin_config", "origin_request_policy_id", "ForwardedValues", "forwarded_values", "WebACLId", "\"Logging\":", "LambdaFunctionAssociations", "aws_cloudfront_origin_access_identity", "s3:PutObject", "s3:ListBucket"} {
					if strings.Contains(content, bad) {
						t.Fatalf("unsupported projection %s", bad)
					}
				}
				if target == "terraform" {
					for _, f := range a.Files {
						if strings.HasSuffix(f.Path, ".tf") {
							if _, d := hclsyntax.ParseConfig([]byte(f.Content), f.Path, hcl.InitialPos); d.HasErrors() {
								t.Fatal(d.Error())
							}
						}
					}
					for _, part := range []string{"aws_cloudfront_distribution", "aws_cloudfront_cache_policy", "aws_cloudfront_origin_access_control", "signing_behavior", "sigv4", "bucket_regional_domain_name", "redirect-to-https", "prevent_destroy", "retain_on_delete", "min_ttl", "enable_accept_encoding_brotli"} {
						if !strings.Contains(content, part) {
							t.Fatalf("missing %s", part)
						}
					}
					security := fileContent(t, a, "infrastructure/security.tf")
					for _, part := range []string{"s3:GetObject", "cloudfront.amazonaws.com", "AWS:SourceArn", "StringEquals", "aws_cloudfront_distribution.distribution.arn", "aws_s3_bucket.origin.arn", "/*"} {
						if !strings.Contains(security, part) {
							t.Fatalf("missing policy %s in %s", part, security)
						}
					}
					if strings.Contains(security, "s3:ListBucket") || strings.Contains(security, "s3:PutObject") {
						t.Fatal("widened origin policy")
					}
					if alias {
						for _, part := range []string{"aws_acm_certificate_validation.certificate_validation.certificate_arn", "TLSv1.2_2021", "allow_overwrite = false", "evaluate_target_health = false", "aws_cloudfront_distribution.distribution.hosted_zone_id"} {
							if !strings.Contains(content, part) {
								t.Fatalf("missing alias %s", part)
							}
						}
					} else if strings.Contains(content, "minimum_protocol_version") || strings.Contains(content, "aws_route53_record") {
						t.Fatal("default viewer falsely claims custom TLS or alias")
					}
				} else {
					var tpl struct {
						Resources map[string]struct {
							Type                string
							Properties          map[string]any
							DeletionPolicy      string
							UpdateReplacePolicy string
						}
					}
					if json.Unmarshal([]byte(content), &tpl) != nil {
						t.Fatal("invalid CF JSON")
					}
					counts := map[string]int{}
					for _, r := range tpl.Resources {
						counts[r.Type]++
						if strings.HasPrefix(r.Type, "AWS::CloudFront::") || r.Type == "AWS::Route53::RecordSet" || r.Type == "AWS::S3::BucketPolicy" {
							if r.DeletionPolicy != "Retain" || r.UpdateReplacePolicy != "Retain" {
								t.Fatal("lost protection")
							}
						}
					}
					if counts["AWS::CloudFront::Distribution"] != 1 || counts["AWS::CloudFront::OriginAccessControl"] != 1 || counts["AWS::CloudFront::CachePolicy"] != 1 || counts["AWS::S3::BucketPolicy"] != 1 || counts["AWS::Route53::RecordSet"] != map[bool]int{false: 0, true: 2}[alias] {
						t.Fatalf("projection counts %v", counts)
					}
					for _, part := range []string{"AWS:SourceArn", "StringEquals", "cloudfront.amazonaws.com", "s3:GetObject", ":distribution/", "OriginAccessIdentity"} {
						if !strings.Contains(content, part) {
							t.Fatalf("missing CF authority %s", part)
						}
					}
					if alias {
						for _, part := range []string{"Z2FDTNDATAQYW2", "AcmCertificateArn", "SslSupportMethod", "TLSv1.2_2021", "EvaluateTargetHealth"} {
							if !strings.Contains(content, part) {
								t.Fatalf("missing custom viewer %s", part)
							}
						}
					} else if strings.Contains(content, "MinimumProtocolVersion") {
						t.Fatal("default certificate TLS falsely forced")
					}
				}
				golden := filepath.Join("testdata", "cloudfront-goldens-v1", map[bool]string{false: "default", true: "alias"}[alias], name)
				if os.Getenv("CLOUDMARKUP_UPDATE_CLOUDFRONT_GOLDENS") == "1" {
					if err := os.MkdirAll(filepath.Dir(golden), 0700); err != nil {
						t.Fatal(err)
					}
					if err := os.WriteFile(golden, []byte(content), 0600); err != nil {
						t.Fatal(err)
					}
				}
				want, err := os.ReadFile(golden)
				if err != nil || string(want) != content {
					t.Fatal("CloudFront golden drift")
				}
				again, d := kmsArtifact(cloneNormalized(t, m), target)
				assertNoTargetErrors(t, d)
				if !reflect.DeepEqual(a, again) {
					t.Fatal("nondeterministic CloudFront export")
				}
			})
		}
	}
}

func TestCloudfrontDefaultViewerRegionalOrigin(t *testing.T) {
	for _, target := range []string{"terraform", "cloudformation"} {
		m := cloudfrontModel(false)
		m.Provenance.Region = "us-west-2"
		setResourceValue(m, "certificate", "certificateRegion", stringValueConfig("us-west-2"))
		a, d := kmsArtifact(m, target)
		assertNoTargetErrors(t, d)
		if a == nil {
			t.Fatal("default viewer incorrectly requires an east-region origin")
		}
	}
}

func TestCloudfrontCommercialPartitionBoundary(t *testing.T) {
	for _, region := range []string{"us-iso-east-1", "eu-isoe-west-1", "eusc-de-east-1"} {
		for _, target := range []string{"terraform", "cloudformation"} {
			t.Run(region+"/"+target, func(t *testing.T) {
				m := cloudfrontModel(false)
				m.Provenance.Region = region
				setResourceValue(m, "certificate", "certificateRegion", stringValueConfig(region))
				a, d := kmsArtifact(m, target)
				if a != nil || !ecsHasErrors(d) {
					t.Fatal("noncommercial partition admitted")
				}
			})
		}
	}
}
func TestCloudfrontImmutableArchitectureCompile(t *testing.T) {
	for _, alias := range []bool{false, true} {
		for _, target := range []TargetKind{TargetTerraform, TargetCloudFormation} {
			architecture := decodeMap(t, architectureFromNormalized(t, cloudfrontModel(alias)))
			architecture["workloadBehavior"].(map[string]any)["workloads"] = []any{}
			input, err := json.Marshal(architecture)
			if err != nil {
				t.Fatal(err)
			}
			request := CompileRequest{Request: Request{Architecture: input, Target: target}}
			first := Compile(context.Background(), request)
			if !first.Succeeded() || first.Artifact == nil {
				t.Fatalf("immutable CloudFront compile failed %v", first.Diagnostics)
			}
			again := Compile(context.Background(), request)
			if !reflect.DeepEqual(first, again) {
				t.Fatal("immutable compile drift")
			}
		}
	}
}
func TestCloudfrontRejectedIntent(t *testing.T) {
	mutations := map[string]func(*NormalizedSolution){
		"missing-attestation": func(m *NormalizedSolution) {
			for i := range m.Resources {
				if m.Resources[i].ID == "distribution" {
					delete(m.Resources[i].Configuration.Values, "publicContentAttested")
				}
			}
		},
		"public-content-false": func(m *NormalizedSolution) {
			setResourceValue(m, "distribution", "publicContentAttested", boolValue(false))
		}, "ttl-order": func(m *NormalizedSolution) { setResourceValue(m, "static_cache", "defaultTtl", integerValue(3601)) }, "cache-key": func(m *NormalizedSolution) {
			setResourceValue(m, "static_cache", "forwardViewerCookies", boolValue(true))
		}, "root-path": func(m *NormalizedSolution) {
			setResourceValue(m, "distribution", "defaultRootObject", stringValueConfig("../secret"))
		}, "public-origin": func(m *NormalizedSolution) { setResourceValue(m, "origin", "blockPublicAccess", boolValue(false)) }, "kms-origin": func(m *NormalizedSolution) { setResourceValue(m, "origin", "encryption", stringValueConfig("SSE-KMS")) }, "write-policy": func(m *NormalizedSolution) {
			setResourceValue(m, "origin_policy_statement", "actions", stringList("s3:GetObject", "s3:PutObject"))
		}, "principal": func(m *NormalizedSolution) {
			setResourceValue(m, "origin_policy_statement", "principals", stringList("*"))
		}, "deny": func(m *NormalizedSolution) {
			setResourceValue(m, "origin_policy_statement", "effect", stringValueConfig("deny"))
		}, "raw-scope": func(m *NormalizedSolution) {
			setResourceValue(m, "origin_policy_statement", "resourceExpressions", stringList("*"))
		}, "alias-domain": func(m *NormalizedSolution) {
			setResourceValue(m, "viewer_alias", "domainName", stringValueConfig("other.example.test"))
		}, "viewer-region": func(m *NormalizedSolution) {
			setResourceValue(m, "certificate", "certificateRegion", stringValueConfig("us-west-2"))
		}, "viewer-intent": func(m *NormalizedSolution) {
			setResourceValue(m, "certificate", "intendedUse", stringValueConfig("regional"))
		}, "noncommercial": func(m *NormalizedSolution) { m.Provenance.Region = "cn-north-1" }, "missing-origin": func(m *NormalizedSolution) { removeNetworkingResource(m, "origin") }, "missing-cache": func(m *NormalizedSolution) { removeNetworkingResource(m, "static_cache") }, "missing-zone": func(m *NormalizedSolution) { removeNetworkingResource(m, "public_zone") }, "wrong-policy-provenance": func(m *NormalizedSolution) {
			for i := range m.Resources {
				if m.Resources[i].ID == "origin_policy" {
					m.Resources[i].Lifecycle.Provenance.GeneratorID = "aws.unreviewed"
				}
			}
		}, "wrong-parent": func(m *NormalizedSolution) {
			for i := range m.Resources {
				if m.Resources[i].ID == "viewer_alias" {
					m.Resources[i].Parent.NodeID = "static_cache"
				}
			}
		}, "wrong-port": func(m *NormalizedSolution) {
			for i := range m.Connections {
				if m.Connections[i].RelationshipType == cloudfrontOrigin {
					m.Connections[i].Source.Port = "aws.cloudfront.distribution.alias"
				}
			}
		}, "binding-config": func(m *NormalizedSolution) {
			for i := range m.Connections {
				if m.Connections[i].RelationshipType == cloudfrontOrigin {
					m.Connections[i].Configuration.Values = map[string]ConfigurationValue{"unreviewed": boolValue(true)}
				}
			}
		}, "policy-owner-port": func(m *NormalizedSolution) {
			for i := range m.Connections {
				if m.Connections[i].ID == "origin_policy_owner" {
					m.Connections[i].Source.Port = "aws.iam.policy-document.statement"
				}
			}
		},
	}
	for name, mutate := range mutations {
		for _, target := range []string{"terraform", "cloudformation"} {
			if target == "cloudformation" {
				switch name {
				case "missing-attestation", "public-content-false", "write-policy", "viewer-region", "noncommercial", "missing-origin", "wrong-policy-provenance":
				default:
					continue
				}
			}
			t.Run(target+"/"+name, func(t *testing.T) {
				m := cloudfrontModel(true)
				mutate(m)
				a, d := kmsArtifact(m, target)
				if a != nil || !ecsHasErrors(d) {
					t.Fatalf("unsupported intent exported: %v", d)
				}
			})
		}
	}
}
func TestCloudfrontReviewedSchemasMatchCatalog(t *testing.T) {
	contents, err := os.ReadFile(filepath.Join("..", "..", "packages", "provider-aws", "src", "compiled", "catalog-v1.json"))
	if err != nil {
		t.Fatal(err)
	}
	var catalog struct {
		Services []struct {
			ID            string
			Configuration struct {
				JSONSchema struct{ Properties map[string]ecsField }
			}
		}
	}
	if json.Unmarshal(contents, &catalog) != nil {
		t.Fatal("invalid catalog")
	}
	count := 0
	for _, service := range catalog.Services {
		if expected, ok := cloudfrontSchemas[service.ID]; ok {
			count++
			if !reflect.DeepEqual(expected, service.Configuration.JSONSchema.Properties) {
				t.Fatal("CloudFront source/native schema drift")
			}
		}
	}
	if count != 3 {
		t.Fatal("missing native CloudFront definitions")
	}
}
