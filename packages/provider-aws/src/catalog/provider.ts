import {
  defineProviderCatalogMetadataV1,
  defineProviderMetadataV1,
} from "@cloudmarkup/provider-sdk";

export const awsProviderMetadataV1 = defineProviderMetadataV1({
  id: "aws.cloudmarkup",
  displayName: "Amazon Web Services",
  description:
    "AWS provider metadata for bounded CloudMarkup catalogs. Catalog entries remain versioned and cannot imply compiler or deployment behavior.",
  iconNamespace: "aws.cloudmarkup.icons",
  homepage: "https://aws.amazon.com/",
  documentation: [
    {
      kind: "official",
      id: "aws.cloudmarkup.documentation.home",
      title: "AWS documentation",
      publisher: "Amazon Web Services",
      url: "https://docs.aws.amazon.com/",
    },
  ],
});

export const awsCatalogMetadataV1 = defineProviderCatalogMetadataV1({
  id: "aws.cloudmarkup.notes-api-catalog",
  version: "0.30.0",
  maturity: "curated",
  description:
    "Curated AWS infrastructure for serverless applications, networking, events, FSx, KMS, Secrets Manager, EC2, ECR, ECS Fargate, PostgreSQL RDS and Aurora, DNS, ACM, CloudFront, ALB and EBS. Reviewed Terraform and CloudFormation exports follow explicit graph configuration. Lambda application generation supports reviewed patterns; external assets, credentials, domain ownership and live deployment evidence remain caller responsibilities.",
  architectureDocumentSchemaVersions: [1, 2, 3],
  runtimeRetrieval: "forbidden",
});
