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

func dnsModel(_ bool) *NormalizedSolution {
	m := auroraModel(false)
	m.Resources = nil
	m.Connections = nil
	m.Outputs = nil
	m.Provenance.Catalog = CatalogReference{ID: TerraformCatalogID, Version: CurrentAwsCatalogVersion, Digest: CurrentAwsCatalogDigest}
	zone := networkResource("public_zone", "public_zone", servicePublicZone, servicePublicZone+".configuration", "1.0.0", map[string]ConfigurationValue{"domainName": stringValueConfig("example.test"), "comment": stringValueConfig("Synthetic public DNS authority"), "domainControlAttested": boolValue(true), "zoneType": stringValueConfig("public"), "delegationMode": stringValueConfig("external"), "retain": boolValue(true), "forceDestroy": boolValue(false)})
	cert := networkResource("certificate", "certificate", servicePublicCertificate, servicePublicCertificate+".configuration", "1.0.0", map[string]ConfigurationValue{"domainName": stringValueConfig("app.example.test"), "certificateRegion": stringValueConfig("us-east-1"), "intendedUse": stringValueConfig("regional"), "certificateType": stringValueConfig("public"), "validationMethod": stringValueConfig("DNS"), "keyAlgorithm": stringValueConfig("RSA_2048"), "certificateExport": stringValueConfig("DISABLED"), "transparencyLogging": stringValueConfig("ENABLED"), "validationRecordsMode": stringValueConfig("managed-dns"), "retain": boolValue(true)})
	m.Resources = []NormalizedResource{zone, cert}
	edge := networkConnection("certificate_zone", dnsCertificateBinding, cert, zone)
	edge.Configuration.SchemaID = dnsCertificateBinding + ".connection"
	m.Connections = []NormalizedConnection{edge}
	for _, n := range m.Resources {
		attrs := []string{"arn"}
		if n.ServiceType == servicePublicZone {
			attrs = []string{"zoneId", "nameServers"}
		}
		for _, attr := range attrs {
			ref := reference(n)
			ref.Attribute = n.ServiceType + "." + attr
			m.Outputs = append(m.Outputs, NormalizedOutput{ID: n.ID + "_" + attr, Key: n.ID + "_" + attr, Kind: "node-attribute", Resource: &ref})
		}
	}
	sortModel(m)
	return m
}
func TestDnsNativeExports(t *testing.T) {
	for _, target := range []string{"terraform", "cloudformation"} {
		t.Run(target, func(t *testing.T) {
			m := dnsModel(false)
			before := cloneNormalized(t, m)
			artifact, d := kmsArtifact(m, target)
			assertNoTargetErrors(t, d)
			if artifact == nil {
				t.Fatal("missing DNS export")
			}
			if !reflect.DeepEqual(m, before) {
				t.Fatal("source mutated")
			}
			path, name := "infrastructure/dns.tf", "dns.tf"
			if target == "cloudformation" {
				path, name = cloudFormationTemplatePath, "template.json"
			}
			content := fileContent(t, artifact, path)
			for _, bad := range []string{"private_key", "certificate_body", "CertificateAuthorityArn", "ValidationDomain", "SubjectAlternativeNames", "AWS::Route53::RecordSet", "\"Region\""} {
				if strings.Contains(content, bad) {
					t.Fatalf("unsupported projection %s", bad)
				}
			}
			if target == "terraform" {
				for _, file := range artifact.Files {
					if strings.HasSuffix(file.Path, ".tf") {
						if _, d := hclsyntax.ParseConfig([]byte(file.Content), file.Path, hcl.InitialPos); d.HasErrors() {
							t.Fatal(d.Error())
						}
					}
				}
				for _, part := range []string{"aws_route53_zone", "aws_acm_certificate", "aws_route53_record", "aws_acm_certificate_validation", "one(aws_acm_certificate.certificate.domain_validation_options).resource_record_name", "one(aws_acm_certificate.certificate.domain_validation_options).resource_record_type", "one(aws_acm_certificate.certificate.domain_validation_options).resource_record_value", "aws_route53_zone.public_zone.zone_id", "prevent_destroy", "create_before_destroy", "force_destroy = false", "allow_overwrite = false", "validation_record_fqdns", "DISABLED"} {
					if !strings.Contains(content, part) {
						t.Fatalf("missing native DNS projection %s", part)
					}
				}
				outputs := fileContent(t, artifact, "infrastructure/outputs.tf")
				if !strings.Contains(outputs, "aws_acm_certificate_validation.certificate_validation.certificate_arn") || !strings.Contains(outputs, "aws_route53_zone.public_zone.name_servers") {
					t.Fatal("typed validated certificate/nameserver metadata lost")
				}
			} else {
				var template struct {
					Resources map[string]struct {
						Type                string
						Properties          map[string]any
						DeletionPolicy      string
						UpdateReplacePolicy string
					}
				}
				if json.Unmarshal([]byte(content), &template) != nil {
					t.Fatal("invalid CF JSON")
				}
				if len(template.Resources) != 2 {
					t.Fatal("invented native certificate helpers")
				}
				for _, resource := range template.Resources {
					if resource.DeletionPolicy != "Retain" || resource.UpdateReplacePolicy != "Retain" {
						t.Fatal("lifecycle guard lost")
					}
					p := resource.Properties
					if resource.Type == "AWS::Route53::HostedZone" {
						if p["HostedZoneTags"] == nil || p["Tags"] != nil || p["VPCs"] != nil {
							t.Fatal("incorrect public zone properties")
						}
					} else if resource.Type == "AWS::CertificateManager::Certificate" {
						if p["DomainName"] != "app.example.test" || p["ValidationMethod"] != "DNS" || p["CertificateExport"] != "DISABLED" {
							t.Fatal("incorrect public certificate shape")
						}
						options := p["DomainValidationOptions"].([]any)
						if len(options) != 1 {
							t.Fatal("DNS validation option count")
						}
						option := options[0].(map[string]any)
						if option["DomainName"] != p["DomainName"] || option["HostedZoneId"].(map[string]any)["Ref"] == nil {
							t.Fatal("exact native zone/domain authority lost")
						}
					} else {
						t.Fatal("unknown resource")
					}
				}
				if !strings.Contains(content, "NameServers") {
					t.Fatal("nameserver metadata lost")
				}
			}
			golden := filepath.Join("testdata", "dns-acm-goldens-v1", name)
			if os.Getenv("CLOUDMARKUP_UPDATE_DNS_GOLDENS") == "1" {
				if err := os.MkdirAll(filepath.Dir(golden), 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(golden, []byte(content), 0600); err != nil {
					t.Fatal(err)
				}
			}
			expected, err := os.ReadFile(golden)
			if err != nil || string(expected) != content {
				t.Fatal("DNS golden drift")
			}
			reordered := cloneNormalized(t, m)
			reordered.Resources[0], reordered.Resources[1] = reordered.Resources[1], reordered.Resources[0]
			sortModel(reordered)
			again, d := kmsArtifact(reordered, target)
			assertNoTargetErrors(t, d)
			if !reflect.DeepEqual(artifact, again) {
				t.Fatal("ordering changed native bytes")
			}
		})
	}
}
func TestDnsImmutableArchitectureCompile(t *testing.T) {
	for _, target := range []TargetKind{TargetTerraform, TargetCloudFormation} {
		architecture := decodeMap(t, architectureFromNormalized(t, dnsModel(false)))
		architecture["workloadBehavior"].(map[string]any)["workloads"] = []any{}
		input, err := json.Marshal(architecture)
		if err != nil {
			t.Fatal(err)
		}
		req := CompileRequest{Request: Request{Architecture: input, Target: target}}
		first := Compile(context.Background(), req)
		if !first.Succeeded() || first.Artifact == nil {
			t.Fatalf("immutable DNS compile failed: %v", first.Diagnostics)
		}
		again := Compile(context.Background(), req)
		if !again.Succeeded() || !reflect.DeepEqual(first.Artifact, again.Artifact) {
			t.Fatal("immutable compilation drift")
		}
	}
}
func TestDnsReviewedSchemasMatchCatalog(t *testing.T) {
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
		if expected, ok := dnsSchemas[service.ID]; ok {
			count++
			if !reflect.DeepEqual(expected, service.Configuration.JSONSchema.Properties) {
				t.Fatal("DNS source/native schema drift")
			}
		}
	}
	if count != 2 {
		t.Fatal("missing native DNS cards")
	}
}
func TestDnsRuleOwnedBinding(t *testing.T) {
	for _, target := range []string{"terraform", "cloudformation"} {
		m := dnsModel(false)
		m.Connections[0].Lifecycle = Lifecycle{Ownership: "generated", Origin: "connection-rule", Provenance: &GeneratedProvenance{GeneratorKind: "connection-rule", GeneratorID: dnsCertificateBinding, GeneratorVersion: "1.0.0", OperationID: "operation_dns", DependentNodeIDs: []string{"certificate", "public_zone"}, DependentEdgeIDs: []string{}}}
		a, d := kmsArtifact(m, target)
		assertNoTargetErrors(t, d)
		if a == nil {
			t.Fatal("explicit resolver binding missing")
		}
		for _, mode := range []string{"wrong-rule", "wrong-version", "missing-dependency", "adopted"} {
			bad := cloneNormalized(t, m)
			l := &bad.Connections[0].Lifecycle
			switch mode {
			case "wrong-rule":
				l.Provenance.GeneratorID = "aws.acm.unreviewed"
			case "wrong-version":
				l.Provenance.GeneratorVersion = "9.0.0"
			case "missing-dependency":
				l.Provenance.DependentNodeIDs = []string{"certificate"}
			case "adopted":
				l.Ownership = "adopted"
			}
			a, d := kmsArtifact(bad, target)
			if a != nil || !ecsHasErrors(d) {
				t.Fatalf("%s admitted %s binding", target, mode)
			}
		}
	}
}
func TestDnsBoundedShapesFailClosed(t *testing.T) {
	cases := map[string]func(*NormalizedSolution){
		"unattested": func(m *NormalizedSolution) { ec2Set(m, "public_zone", "domainControlAttested", boolValue(false)) }, "private-zone": func(m *NormalizedSolution) { ec2Set(m, "public_zone", "zoneType", stringValueConfig("private")) }, "force-destroy": func(m *NormalizedSolution) { ec2Set(m, "public_zone", "forceDestroy", boolValue(true)) }, "unretained-zone": func(m *NormalizedSolution) { ec2Set(m, "public_zone", "retain", boolValue(false)) }, "email": func(m *NormalizedSolution) { ec2Set(m, "certificate", "validationMethod", stringValueConfig("EMAIL")) }, "wildcard": func(m *NormalizedSolution) {
			ec2Set(m, "certificate", "domainName", stringValueConfig("*.example.test"))
		}, "SANs": func(m *NormalizedSolution) {
			ec2Set(m, "certificate", "subjectAlternativeNames", stringValueConfig("synthetic-sensitive-sentinel"))
		}, "key-material": func(m *NormalizedSolution) {
			ec2Set(m, "certificate", "privateKey", stringValueConfig("synthetic-sensitive-sentinel"))
		}, "exportable": func(m *NormalizedSolution) {
			ec2Set(m, "certificate", "certificateExport", stringValueConfig("ENABLED"))
		}, "private-CA": func(m *NormalizedSolution) { ec2Set(m, "certificate", "certificateType", stringValueConfig("private")) }, "unreviewed-algorithm": func(m *NormalizedSolution) {
			ec2Set(m, "certificate", "keyAlgorithm", stringValueConfig("EC_prime256v1"))
		}, "manual-validation": func(m *NormalizedSolution) {
			ec2Set(m, "certificate", "validationRecordsMode", stringValueConfig("manual"))
		}, "no-zone": func(m *NormalizedSolution) { ec2RemoveEdge(m, "certificate_zone") }, "cross-region": func(m *NormalizedSolution) {
			ec2Set(m, "certificate", "certificateRegion", stringValueConfig("us-west-2"))
		}, "viewer-west": func(m *NormalizedSolution) {
			m.Provenance.Region = "us-west-2"
			ec2Set(m, "certificate", "certificateRegion", stringValueConfig("us-west-2"))
			ec2Set(m, "certificate", "intendedUse", stringValueConfig("cloudfront-viewer"))
		}, "wrong-suffix": func(m *NormalizedSolution) {
			ec2Set(m, "certificate", "domainName", stringValueConfig("notexample.test"))
		}, "upper-domain": func(m *NormalizedSolution) {
			ec2Set(m, "certificate", "domainName", stringValueConfig("APP.example.test"))
		}, "trailing-dot": func(m *NormalizedSolution) {
			ec2Set(m, "public_zone", "domainName", stringValueConfig("example.test."))
		}, "duplicate-zone": func(m *NormalizedSolution) {
			zone, _ := modelResource(m, "public_zone")
			zone.ID, zone.DeploymentKey = "duplicate_zone", "duplicate_zone"
			m.Resources = append(m.Resources, zone)
		}, "duplicate-certificate": func(m *NormalizedSolution) {
			cert, _ := modelResource(m, "certificate")
			cert.ID, cert.DeploymentKey = "duplicate_certificate", "duplicate_certificate"
			m.Resources = append(m.Resources, cert)
		}, "shadow-zone": func(m *NormalizedSolution) {
			zone, _ := modelResource(cloneNormalized(t, m), "public_zone")
			zone.ID, zone.DeploymentKey = "child_zone", "child_zone"
			zone.Configuration.Values["domainName"] = stringValueConfig("app.example.test")
			m.Resources = append(m.Resources, zone)
		}, "unsupported-metadata": func(m *NormalizedSolution) {
			cert, _ := modelResource(m, "certificate")
			ref := reference(cert)
			ref.Attribute = servicePublicCertificate + ".privateKey"
			m.Outputs = append(m.Outputs, NormalizedOutput{ID: "unsupported", Key: "unsupported", Kind: "node-attribute", Resource: &ref})
		},
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			for _, target := range []string{"terraform", "cloudformation"} {
				m := cloneNormalized(t, dnsModel(false))
				change(m)
				sortModel(m)
				a, d := kmsArtifact(m, target)
				if a != nil || !ecsHasErrors(d) {
					t.Fatalf("%s admitted %s: %v", target, name, d)
				}
				if name == "duplicate-certificate" || name == "trailing-dot" {
					code, nodeID, path := "TARGET_DNS_DUPLICATE_DOMAIN", "duplicate_certificate", ""
					if name == "trailing-dot" {
						code, nodeID, path = "TARGET_DNS_FIELD_INVALID", "public_zone", "$.semantic.configuration.values.domainName"
					}
					if target == "cloudformation" {
						code = "CLOUDFORMATION_" + strings.TrimPrefix(code, "TARGET_")
					}
					found := false
					for _, diagnostic := range d {
						if diagnostic.Code == code && diagnostic.Severity == SeverityError && diagnostic.Source.Document == DocumentArchitecture && diagnostic.Source.NodeID == nodeID && diagnostic.Source.Path == path {
							found = true
						}
					}
					if !found {
						t.Fatalf("%s missing %s for %s%s: %v", target, code, nodeID, path, d)
					}
				}
				for _, diagnostic := range d {
					if strings.Contains(diagnostic.Message, "synthetic-sensitive-sentinel") {
						t.Fatal("value leaked")
					}
				}
			}
		})
	}
}
func TestDnsRegionalAndViewerIntent(t *testing.T) {
	for _, target := range []string{"terraform", "cloudformation"} {
		for _, viewer := range []bool{false, true} {
			m := dnsModel(false)
			if viewer {
				ec2Set(m, "certificate", "intendedUse", stringValueConfig("cloudfront-viewer"))
			} else {
				m.Provenance.Region = "us-west-2"
				ec2Set(m, "certificate", "certificateRegion", stringValueConfig("us-west-2"))
			}
			a, d := kmsArtifact(m, target)
			assertNoTargetErrors(t, d)
			if a == nil {
				t.Fatal("valid declared Region missing")
			}
		}
	}
}
