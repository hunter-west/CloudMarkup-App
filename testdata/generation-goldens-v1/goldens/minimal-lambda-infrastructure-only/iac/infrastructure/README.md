# Cloud Markup deterministic Terraform

This directory was generated from immutable Architecture and Workload contracts. It does not build application source, run Terraform, or deploy.

## Compatibility

- Compiler: `cloudmarkup.iac-compiler@1.2.1`
- Catalog: `aws.cloudmarkup.notes-api-catalog@0.30.0` (`sha256:7bc6db32a69c5dd33ef85e02e2ebd38bb47333670259696165149ce39bcca682`)
- Target format: `1.0.0`
- Terraform: `>= 1.5.0, < 2.0.0`
- AWS provider: `hashicorp/aws` (`>= 6.55.0, < 7.0.0`)
- Architecture revision: `revision_notes_1`
- Solution Revision: `solution_notes_1`

## Application artifacts

- `workload_notes` (infrastructure-only): validated-relative-package-input.
  Application code and a validated package are required before plan or deployment.

Copy `terraform.tfvars.example` to a separately protected input file and replace every placeholder. Never put credentials or secret values in committed Terraform files. Review the complete diff, initialize from an approved provider mirror, validate, plan, and deploy only in customer-owned CI/CD with customer approval.
