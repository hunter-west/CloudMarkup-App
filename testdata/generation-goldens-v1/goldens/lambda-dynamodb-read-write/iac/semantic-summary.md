# Terraform semantic summary: lambda-dynamodb-read-write

- Artifact digest: `sha256:bb1a6093d0ee9c72cda76e8aa882eb060a2655a75c648dfc899033ad024b26dd`
- Generated files: 14
- Resources: 5
- Application artifact contracts: 1
- Policy artifacts: 3

## Resources

- `aws_dynamodb_table.notes_read_table`
- `aws_iam_role.notes_role`
- `aws_iam_role_policy.generated_read_policy`
- `aws_iam_role_policy.generated_write_policy`
- `aws_lambda_function.notes_handler`

## Policy provenance

- `generated_read_policy`: `generated/generated-permission`; edges `edge_lambda_reads`
- `generated_write_policy`: `generated/generated-permission`; edges `edge_lambda_writes`
- `trust_policy`: `generated/trust`; edges `edge_role_lambda`
