# Terraform semantic summary: multiple-downstream-dependencies

- Artifact digest: `sha256:d59458bc8fe06f4a69e25e32d82072f53df995f08efa1a1db36f4459889178e9`
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
