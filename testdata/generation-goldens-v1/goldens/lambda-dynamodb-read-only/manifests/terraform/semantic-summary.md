# Terraform semantic summary: lambda-dynamodb-read-only

- Artifact digest: `sha256:45861512127d7f017cf1139fe2e8b5d82746ed1120a0057eff892fd58d8a486f`
- Generated files: 14
- Resources: 4
- Application artifact contracts: 1
- Policy artifacts: 2

## Resources

- `aws_dynamodb_table.notes_read_table`
- `aws_iam_role.notes_role`
- `aws_iam_role_policy.generated_read_policy`
- `aws_lambda_function.notes_handler`

## Policy provenance

- `generated_read_policy`: `generated/generated-permission`; edges `edge_lambda_reads`
- `trust_policy`: `generated/trust`; edges `edge_role_lambda`
