# Terraform semantic summary: generated-plus-custom-policies

- Artifact digest: `sha256:e21ecfb0bc0167b3a27bf8e3c43e16167812e7ad3a99bdf1f1e36dbdfc505c40`
- Generated files: 14
- Resources: 5
- Application artifact contracts: 1
- Policy artifacts: 3

## Resources

- `aws_dynamodb_table.notes_table`
- `aws_iam_role.notes_role`
- `aws_iam_role_policy.custom_policy`
- `aws_iam_role_policy.generated_read_policy`
- `aws_lambda_function.notes_handler`

## Policy provenance

- `custom_policy`: `user/identity-inline`; edges ``
- `generated_read_policy`: `generated/generated-permission`; edges `edge_lambda_reads`
- `trust_policy`: `generated/trust`; edges `edge_role_lambda`
