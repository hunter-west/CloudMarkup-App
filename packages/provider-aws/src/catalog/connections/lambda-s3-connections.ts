import { defineProviderConnectionRuleV1 } from "@cloudmarkup/provider-sdk";
import { lambdaReadsTable } from "./notes-api-connections.js";
export const awsLambdaS3ConnectionRules = ["reads", "writes"].map((mode) => {
  const id = "aws.lambda." + mode + "-s3-bucket";
  const read = mode === "reads";
  return defineProviderConnectionRuleV1({
    ...lambdaReadsTable,
    id,
    relationshipType: id,
    source: {
      serviceId: "aws.lambda.function",
      portId: "aws.lambda.function.data-" + (read ? "read" : "write"),
    },
    target: { serviceId: "aws.s3.bucket", portId: "aws.s3.bucket.object-api" },
    configuration: {
      schemaId: id + ".connection",
      schemaVersion: "1.0.0",
      jsonSchema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "urn:cloudmarkup:configuration:" + id + ".connection:1.0.0",
        type: "object",
        title: read ? "Read S3 objects" : "Write S3 objects",
        additionalProperties: false,
        properties: {},
        required: [],
      },
      uiHints: [],
    },
    questions: [],
    supportingChanges: lambdaReadsTable.supportingChanges.map((change) => ({
      ...change,
      id: change.id.replace("dynamodb-read", "s3-" + mode),
      ...(change.kind === "edge" &&
      change.relationshipType === "aws.iam.authorizes-dynamodb-table"
        ? { relationshipType: "aws.iam.authorizes-s3-bucket" }
        : {}),
      purpose: change.purpose
        .replaceAll("DynamoDB", "S3")
        .replaceAll("table", "bucket")
        .replaceAll("read-only", read ? "read-only" : "write-only"),
    })),
    iamEffects: [
      {
        id: id + ".iam",
        effect: "allow",
        actions: [read ? "s3:GetObject" : "s3:PutObject"],
        resourceScope: "target-node",
        explanation:
          "The Lambda role can " +
          (read ? "read" : "write") +
          " objects only in the selected bucket. Listing and deletion are not granted.",
      },
    ],
    missingInformationFindings: lambdaReadsTable.missingInformationFindings.map(
      (f) => ({
        ...f,
        code: f.code.replace("aws.lambda.finding", id + ".finding"),
        guidedMessage: f.guidedMessage.replace("table", "bucket"),
      }),
    ),
    implementation: {
      status: "implemented",
      interfaceVersion: 1,
      implementationId: id + ".resolve",
    },
    validationRuleIds: [],
    education: {
      summary: read
        ? "Reads objects from the selected bucket"
        : "Writes objects to the selected bucket",
      guidedExplanation:
        "Connect the Lambda execution role first. Review the exact object permission before applying.",
      professionalExplanation:
        "Atomic relationship plus generated role policy with a graph-bound bucket object ARN and exact connection provenance. No ListBucket, DeleteObject, wildcard action or arbitrary ARN.",
      considerations: [
        "Security: Access is limited to objects in this exact bucket.",
        "Operations: Use a separate output bucket to avoid recursive S3 event invocation.",
      ],
      documentation: [
        {
          kind: "official",
          id: id + ".documentation",
          title: "Using Lambda with Amazon S3",
          publisher: "Amazon Web Services",
          url: "https://docs.aws.amazon.com/lambda/latest/dg/with-s3.html",
        },
      ],
    },
  });
});
