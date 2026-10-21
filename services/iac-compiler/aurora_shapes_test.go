package compiler

import (
	"strings"
	"testing"
)

func TestAuroraBoundedShapesFailClosed(t *testing.T) {
	cases := map[string]func(*NormalizedSolution){
		"wrong-engine-major": func(m *NormalizedSolution) { ec2Set(m, "aurora_cluster", "engineVersion", stringValueConfig("17.1")) },
		"v1-mode": func(m *NormalizedSolution) {
			ec2Set(m, "aurora_cluster", "engineMode", stringValueConfig("serverless"))
		},
		"provisioned-class": func(m *NormalizedSolution) { ec2Set(m, "aurora_a", "instanceClass", stringValueConfig("db.r6g.large")) },
		"zero-minimum": func(m *NormalizedSolution) {
			ec2Set(m, "aurora_cluster", "minimumCapacityAcus", stringValueConfig("0"))
		},
		"unreviewed-quarter-acu": func(m *NormalizedSolution) {
			ec2Set(m, "aurora_cluster", "minimumCapacityAcus", stringValueConfig("0.75"))
		},
		"inverted-acus": func(m *NormalizedSolution) {
			ec2Set(m, "aurora_cluster", "minimumCapacityAcus", stringValueConfig("8"))
		},
		"maximum-outside-baseline": func(m *NormalizedSolution) {
			ec2Set(m, "aurora_cluster", "maximumCapacityAcus", stringValueConfig("128"))
		},
		"auto-pause": func(m *NormalizedSolution) { ec2Set(m, "aurora_cluster", "autoPause", boolValue(true)) },

		"password": func(m *NormalizedSolution) {
			ec2Set(m, "aurora_cluster", "masterPassword", stringValueConfig("synthetic-sensitive-sentinel"))
		},
		"custom-key": func(m *NormalizedSolution) {
			ec2Set(m, "aurora_cluster", "encryptionMode", stringValueConfig("customer-managed"))
		},
		"gp3-storage": func(m *NormalizedSolution) { ec2Set(m, "aurora_cluster", "storageType", stringValueConfig("gp3")) },

		"unencrypted":            func(m *NormalizedSolution) { ec2Set(m, "aurora_cluster", "storageEncrypted", boolValue(false)) },
		"unprotected-cluster":    func(m *NormalizedSolution) { ec2Set(m, "aurora_cluster", "deletionProtection", boolValue(false)) },
		"public-member":          func(m *NormalizedSolution) { ec2Set(m, "aurora_a", "publicAccess", boolValue(true)) },
		"unretained-member":      func(m *NormalizedSolution) { ec2Set(m, "aurora_a", "retain", boolValue(false)) },
		"automatic-minor":        func(m *NormalizedSolution) { ec2Set(m, "aurora_a", "autoMinorUpgrade", boolValue(true)) },
		"wrong-parameter-family": func(m *NormalizedSolution) { ec2Set(m, "aurora_parameters", "family", stringValueConfig("postgres16")) },
		"tls-disabled":           func(m *NormalizedSolution) { ec2Set(m, "aurora_parameters", "forceTls", boolValue(false)) },
		"database-keyword":       func(m *NormalizedSolution) { ec2Set(m, "aurora_cluster", "databaseName", stringValueConfig("Table")) },
		"username-keyword": func(m *NormalizedSolution) {
			ec2Set(m, "aurora_cluster", "masterUsername", stringValueConfig("current_user"))
		},
		"member-undeclared-zone": func(m *NormalizedSolution) {
			ec2Set(m, "aurora_a", "availabilityZone", stringValueConfig("us-east-1c"))
		},
		"member-same-zone": func(m *NormalizedSolution) {
			ec2Set(m, "aurora_b", "availabilityZone", stringValueConfig("us-east-1a"))
		},
		"member-same-tier": func(m *NormalizedSolution) { ec2Set(m, "aurora_b", "promotionTier", integerValue(0)) },
		"no-tier-zero":     func(m *NormalizedSolution) { ec2Set(m, "aurora_a", "promotionTier", integerValue(2)) },
		"no-member":        func(m *NormalizedSolution) { ec2RemoveEdge(m, "aurora_member_a"); ec2RemoveEdge(m, "aurora_member_b") },
		"third-member": func(m *NormalizedSolution) {
			member, _ := modelResource(m, "aurora_a")
			member.ID, member.DeploymentKey = "aurora_c", "aurora_c"
			m.Resources = append(m.Resources, member)
			cluster, _ := modelResource(m, "aurora_cluster")
			edge := networkConnection("aurora_member_c", auroraMemberBinding, cluster, member)
			edge.Configuration.SchemaID = auroraMemberBinding + ".connection"
			m.Connections = append(m.Connections, edge)
		},
		"no-subnet-group":   func(m *NormalizedSolution) { ec2RemoveEdge(m, "aurora_subnets") },
		"no-tls-group":      func(m *NormalizedSolution) { ec2RemoveEdge(m, "aurora_tls") },
		"no-security-group": func(m *NormalizedSolution) { ec2RemoveEdge(m, "aurora_security") },
		"one-subnet":        func(m *NormalizedSolution) { ec2RemoveEdge(m, "db_subnet_b") },
		"same-subnet-zone":  func(m *NormalizedSolution) { ec2Set(m, "az_b", "zoneName", stringValueConfig("us-east-1a")) },
		"wrong-region":      func(m *NormalizedSolution) { m.Provenance.Region = "us-west-2" },
		"backup-disabled":   func(m *NormalizedSolution) { ec2Set(m, "aurora_cluster", "backupRetentionDays", integerValue(0)) },
		"backup-wrap": func(m *NormalizedSolution) {
			ec2Set(m, "aurora_cluster", "backupWindow", stringValueConfig("23:45-00:30"))
		},
		"window-overlap": func(m *NormalizedSolution) {
			ec2Set(m, "aurora_cluster", "maintenanceWindow", stringValueConfig("sun:02:15-sun:02:45"))
		},
		"member-secret-output": func(m *NormalizedSolution) {
			member, _ := modelResource(m, "aurora_a")
			ref := reference(member)
			ref.Attribute = serviceAuroraInstance + ".masterUserSecretArn"
			m.Outputs = append(m.Outputs, NormalizedOutput{ID: "unsupported_secret", Key: "unsupported_secret", Kind: "node-attribute", Resource: &ref})
		},
		"parameter-arn-output": func(m *NormalizedSolution) {
			parameters, _ := modelResource(m, "aurora_parameters")
			ref := reference(parameters)
			ref.Attribute = serviceAuroraParameters + ".arn"
			m.Outputs = append(m.Outputs, NormalizedOutput{ID: "unsupported_arn", Key: "unsupported_arn", Kind: "node-attribute", Resource: &ref})
		},
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			for _, target := range []string{"terraform", "cloudformation"} {
				model := auroraModel(true)
				change(model)
				sortModel(model)
				artifact, diagnostics := kmsArtifact(model, target)
				if artifact != nil || !ecsHasErrors(diagnostics) {
					t.Fatalf("%s admitted %s: %v", target, name, diagnostics)
				}
				for _, diagnostic := range diagnostics {
					if strings.Contains(diagnostic.Message, "synthetic-sensitive-sentinel") {
						t.Fatal("configuration value leaked")
					}
				}
			}
		})
	}
}
