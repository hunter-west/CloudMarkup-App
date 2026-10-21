# Terraform semantic summary: custom-inline-iam-policy

- Artifact digest: `sha256:ca2966a318df82ccba91736de9669fb34dd26629c3141a9748c2291f8c46b5f1`
- Generated files: 14
- Resources: 4
- Application artifact contracts: 1
- Policy artifacts: 2

## Resources

- `aws_dynamodb_table.notes_table`
- `aws_iam_role.notes_role`
- `aws_iam_role_policy.custom_policy`
- `aws_lambda_function.notes_handler`

## Policy provenance

- `custom_policy`: `user/identity-inline`; edges ``
- `trust_policy`: `generated/trust`; edges `edge_role_lambda`
