package compiler

import (
	"context"
	"testing"
)

func TestCloudFormationRedriveRejectsNonliteralQueueNames(t *testing.T) {
	for _, nodeID := range []string{"queue_source", "queue_dlq"} {
		for _, test := range []struct {
			name  string
			value ConfigurationValue
		}{
			{"variable", ConfigurationValue{Kind: "variable", VariableID: "queue-name"}},
			{"empty", stringValueConfig("")},
			{"whitespace", stringValueConfig(" ")},
		} {
			t.Run(nodeID+"/"+test.name, func(t *testing.T) {
				model := queueRedriveModelWithSources(1)
				setResourceValue(model, nodeID, "queueName", test.value)
				prepareCuratedCloudFormationModel(model)
				artifact, diagnostics := renderCloudFormationArtifact(context.Background(), model, nil, DefaultLimits())
				if artifact != nil {
					t.Fatal("nonliteral or empty queue name produced an artifact")
				}
				if diagnosticByCode(t, diagnostics, "CLOUDFORMATION_SQS_QUEUE_NAME_UNSUPPORTED").Source.NodeID != nodeID {
					t.Fatal("queue-name diagnostic lost exact resource identity")
				}
			})
		}
	}
}
