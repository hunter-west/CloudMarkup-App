# Terraform semantic summary: lambda-dynamodb-read-only

- Artifact digest: `sha256:b9d820fcbbc8da39ab464c0a2337126a00a462d39622345eea378dfb080efc39`
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
