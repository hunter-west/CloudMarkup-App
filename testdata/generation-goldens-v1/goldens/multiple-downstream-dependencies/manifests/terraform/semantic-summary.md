# Terraform semantic summary: multiple-downstream-dependencies

- Artifact digest: `sha256:051df3076a813c19ec15995ba2d145f2226bc1cefa2623145baf04cd20e96e31`
- Generated files: 14
- Resources: 6
- Application artifact contracts: 1
- Policy artifacts: 3

## Resources

- `aws_dynamodb_table.notes_read_table`
- `aws_dynamodb_table.notes_write_table`
- `aws_iam_role.notes_role`
- `aws_iam_role_policy.generated_read_policy`
- `aws_iam_role_policy.generated_write_policy`
- `aws_lambda_function.notes_handler`

## Policy provenance

- `generated_read_policy`: `generated/generated-permission`; edges `edge_lambda_reads`
- `generated_write_policy`: `generated/generated-permission`; edges `edge_lambda_writes`
- `trust_policy`: `generated/trust`; edges `edge_role_lambda`
