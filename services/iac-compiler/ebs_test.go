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

func ebsModel(customer, attached bool) *NormalizedSolution {
	m := ec2Model(customer)
	m.Provenance.Catalog = CatalogReference{ID: TerraformCatalogID, Version: CurrentAwsCatalogVersion, Digest: CurrentAwsCatalogDigest}
	mode := "account-default"
	if customer {
		mode = "customer-managed"
	}
	z, _ := modelResource(m, "az")
	volume := networkResource("volume", "volume", serviceEbsVolume, serviceEbsVolume+".configuration", "1.0.0", map[string]ConfigurationValue{"name": stringValueConfig("synthetic-data"), "sizeGiB": integerValue(100), "volumeType": stringValueConfig("gp3"), "iops": integerValue(3000), "throughputMiBps": integerValue(125), "encrypted": boolValue(true), "encryptionMode": stringValueConfig(mode), "multiAttach": boolValue(false), "retain": boolValue(true)})
	volume.Parent = &ResourceReference{NodeID: z.ID, TargetKey: z.TargetKey, RelationshipType: ebsZone}
	m.Resources = append(m.Resources, volume)
	m.Connections = append(m.Connections, networkConnection("volume_zone", ebsZone, volume, z))
	if customer {
		key, _ := modelResource(m, "encryption_key")
		m.Connections = append(m.Connections, networkConnection("volume_key", ebsKey, volume, key))
	}
	if attached {
		instance, _ := modelResource(m, "instance")
		a := networkResource("attachment", "attachment", serviceEbsAttachment, serviceEbsAttachment+".configuration", "1.0.0", map[string]ConfigurationValue{"deviceName": stringValueConfig("/dev/sdf"), "guestPreparation": stringValueConfig("external"), "retain": boolValue(true), "forceDetach": boolValue(false)})
		a.Parent = &ResourceReference{NodeID: volume.ID, TargetKey: volume.TargetKey, RelationshipType: ebsOwner}
		m.Resources = append(m.Resources, a)
		m.Connections = append(m.Connections, networkConnection("attachment_owner", ebsOwner, a, volume), networkConnection("attachment_instance", ebsInstance, a, instance))
	}
	ref := reference(volume)
	ref.Attribute = serviceEbsVolume + ".id"
	m.Outputs = []NormalizedOutput{{ID: "volume_id", Key: "volume_id", Kind: "node-attribute", Resource: &ref}}
	sortModel(m)
	return m
}
func TestEbsBothNativeTargets(t *testing.T) {
	for _, customer := range []bool{false, true} {
		for _, attached := range []bool{false, true} {
			for _, target := range []string{"terraform", "cloudformation"} {
				name := map[bool]string{false: "default", true: "customer"}[customer] + "-" + map[bool]string{false: "unattached", true: "attached"}[attached]
				t.Run(name+"/"+target, func(t *testing.T) {
					m := ebsModel(customer, attached)
					before := cloneNormalized(t, m)
					a, d := kmsArtifact(m, target)
					assertNoTargetErrors(t, d)
					if a == nil {
						t.Fatal("missing artifact")
					}
					if !reflect.DeepEqual(m, before) {
						t.Fatal("source mutation")
					}
					warnings := 0
					for _, x := range d {
						if x.Code == "EBS_READINESS_EXTERNAL" {
							warnings++
						}
					}
					want := 1
					if attached {
						want = 2
					}
					if warnings != want {
						t.Fatal("missing EBS external readiness")
					}
					file, goldenName := "infrastructure/ebs.tf", "ebs.tf"
					if target == "cloudformation" {
						file, goldenName = cloudFormationTemplatePath, "template.json"
					}
					content := fileContent(t, a, file)
					if target == "terraform" {
						for _, f := range a.Files {
							if strings.HasSuffix(f.Path, ".tf") {
								if _, diags := hclsyntax.ParseConfig([]byte(f.Content), f.Path, hcl.InitialPos); diags.HasErrors() {
									t.Fatal(diags.Error())
								}
							}
						}
						for _, text := range []string{"availability_zone = \"us-east-1a\"", "encrypted", "gp3", "3000", "125", "prevent_destroy"} {
							if !strings.Contains(strings.Join(strings.Fields(content), " "), text) {
								t.Fatal("missing native volume contract", text)
							}
						}
						if customer != strings.Contains(content, "kms_key_id") {
							t.Fatal("wrong encryption mode projection")
						}
						if attached {
							for _, text := range []string{"aws_volume_attachment", "aws_ebs_volume.volume.id", "aws_instance.instance.id", "skip_destroy", "force_detach"} {
								if !strings.Contains(content, text) {
									t.Fatal("missing native attachment", text)
								}
							}
						} else if strings.Contains(content, "aws_volume_attachment") {
							t.Fatal("attachment inferred")
						}
						if strings.Contains(content, "user_data") || strings.Contains(content, "provisioner") {
							t.Fatal("guest code inferred")
						}
					} else {
						var template cloudFormationTemplate
						if json.Unmarshal([]byte(content), &template) != nil {
							t.Fatal("invalid CF")
						}
						h := &cloudFormationRenderer{model: m, logicalIDs: map[string]string{}, usedLogicalIDs: map[string]string{}}
						h.assignLogicalIDs()
						volume := template.Resources[h.logicalIDs["volume"]]
						if volume.Type != "AWS::EC2::Volume" || volume.DeletionPolicy != "Retain" || volume.UpdateReplacePolicy != "Retain" || volume.Properties["AvailabilityZone"] != "us-east-1a" || volume.Properties["Encrypted"] != true {
							t.Fatal("wrong retained native volume")
						}
						_, hasKey := volume.Properties["KmsKeyId"]
						if hasKey != customer {
							t.Fatal("wrong CF key projection")
						}
						if attached {
							attachment := template.Resources[h.logicalIDs["attachment"]]
							if attachment.Type != "AWS::EC2::VolumeAttachment" || attachment.DeletionPolicy != "Retain" || attachment.Properties["Device"] != "/dev/sdf" || !reflect.DeepEqual(attachment.Properties["VolumeId"], cloudFormationRef(h.logicalIDs["volume"])) || !reflect.DeepEqual(attachment.Properties["InstanceId"], cloudFormationRef(h.logicalIDs["instance"])) {
								t.Fatal("wrong typed attachment")
							}
						}
					}
					golden := filepath.Join("testdata", "ebs-goldens-v1", name, goldenName)
					if os.Getenv("CLOUDMARKUP_UPDATE_EBS_GOLDENS") == "1" {
						if err := os.MkdirAll(filepath.Dir(golden), 0700); err != nil {
							t.Fatal(err)
						}
						if err := os.WriteFile(golden, []byte(content), 0600); err != nil {
							t.Fatal(err)
						}
					}
					b, err := os.ReadFile(golden)
					if err != nil || string(b) != content {
						t.Fatal("EBS golden drift")
					}
					again, d := kmsArtifact(cloneNormalized(t, m), target)
					assertNoTargetErrors(t, d)
					if !reflect.DeepEqual(a, again) {
						t.Fatal("nondeterministic export")
					}
					if os.Getenv("CLOUDMARKUP_WRITE_EBS_FIXTURES") == "1" && target == "terraform" {
						doc := decodeMap(t, architectureFromNormalized(t, m))
						doc["workloadBehavior"].(map[string]any)["workloads"] = []any{}
						b, err := json.MarshalIndent(doc, "", "  ")
						if err != nil {
							t.Fatal(err)
						}
						dir := filepath.Join("..", "..", "packages", "provider-aws", "fixtures", "ebs-v1")
						if err := os.MkdirAll(dir, 0700); err != nil {
							t.Fatal(err)
						}
						if err := os.WriteFile(filepath.Join(dir, name+".json"), append(b, '\n'), 0600); err != nil {
							t.Fatal(err)
						}
					}
				})
			}
		}
	}
}
func TestEbsImmutableCompilation(t *testing.T) {
	for _, customer := range []bool{false, true} {
		for _, target := range []TargetKind{TargetTerraform, TargetCloudFormation} {
			m := ebsModel(customer, true)
			doc := decodeMap(t, architectureFromNormalized(t, m))
			doc["workloadBehavior"].(map[string]any)["workloads"] = []any{}
			input, err := json.Marshal(doc)
			if err != nil {
				t.Fatal(err)
			}
			request := CompileRequest{Request: Request{Architecture: input, Target: target}}
			first := Compile(context.Background(), request)
			if !first.Succeeded() {
				t.Fatal(first.Diagnostics)
			}
			if !reflect.DeepEqual(first, Compile(context.Background(), request)) {
				t.Fatal("not immutable/deterministic")
			}
		}
	}
}
