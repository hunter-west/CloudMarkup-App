# Terraform semantic summary: custom-inline-iam-policy

- Artifact digest: `sha256:ae2b180f9aa622d5109b03e8efae1ff00314732df12afd3ae784ab99a1f4fb8d`
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
