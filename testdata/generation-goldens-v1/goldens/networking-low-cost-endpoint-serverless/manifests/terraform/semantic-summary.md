# Terraform semantic summary: networking-low-cost-endpoint-serverless

- Artifact digest: `sha256:5bb09e29abccfea030acbbe057cbd17931bf39b9bdc526b9e128926cb4139bae`
- Generated files: 14
- Resources: 14
- Application artifact contracts: 1
- Policy artifacts: 2

## Resources

- `aws_iam_role.notes_role`
- `aws_iam_role_policy_attachment.lambda_vpc_access`
- `aws_lambda_function.notes_handler`
- `aws_route_table.private_a_routes`
- `aws_route_table.private_b_routes`
- `aws_route_table_association.private_a_association`
- `aws_route_table_association.private_b_association`
- `aws_security_group.application`
- `aws_subnet.private_a_subnet`
- `aws_subnet.private_b_subnet`
- `aws_vpc.application`
- `aws_vpc_endpoint.s3_endpoint`
- `aws_vpc_security_group_egress_rule.application_https_egress`
- `aws_vpc_security_group_ingress_rule.application_https_ingress`

## Policy provenance

- `s3_endpoint_policy`: `user/resource`; edges ``
- `trust_policy`: `generated/trust`; edges `edge_role_lambda`
