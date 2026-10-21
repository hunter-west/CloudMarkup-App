# Cloud Markup deterministic Terraform

This directory was generated from immutable Architecture and Workload contracts. It does not build application source, run Terraform, or deploy.

## Compatibility

- Compiler: `cloudmarkup.iac-compiler@1.2.1`
- Catalog: `aws.cloudmarkup.notes-api-catalog@0.30.0` (`sha256:8e9b1b23bbcdf723352044baddd8e79468d70ed5a719af914036992daf91fb94`)
- Target format: `1.0.0`
- Terraform: `>= 1.5.0, < 2.0.0`
- AWS provider: `hashicorp/aws` (`>= 6.55.0, < 7.0.0`)
- Architecture revision: `revision_notes_1`
- Solution Revision: `solution_notes_1`

## Application artifacts

- `workload_notes` (generated-starter): deterministic-relative-package at `../application/artifacts/workload_notes/function.zip`.

Copy `terraform.tfvars.example` to a separately protected input file and replace every placeholder. Never put credentials or secret values in committed Terraform files. Review the complete diff, initialize from an approved provider mirror, validate, plan, and deploy only in customer-owned CI/CD with customer approval.
