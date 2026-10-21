# Terraform semantic summary: networking-two-az-public-private

- Artifact digest: `sha256:c2844e02b26960aa598bd3b3c56253dac27207f1c4157cb68c63da162080cd6c`
- Generated files: 14
- Resources: 25
- Application artifact contracts: 1
- Policy artifacts: 2

## Resources

- `aws_iam_role.notes_role`
- `aws_iam_role_policy_attachment.lambda_vpc_access`
- `aws_internet_gateway.internet_gateway`
- `aws_lambda_function.notes_handler`
- `aws_nat_gateway.nat_a`
- `aws_nat_gateway.nat_b`
- `aws_route.private_default_a`
- `aws_route.private_default_b`
- `aws_route.public_default`
- `aws_route_table.private_a_routes`
- `aws_route_table.private_b_routes`
- `aws_route_table.public_routes`
- `aws_route_table_association.private_a_association`
- `aws_route_table_association.private_b_association`
- `aws_route_table_association.public_a_association`
- `aws_route_table_association.public_b_association`
- `aws_security_group.application`
- `aws_subnet.private_a_subnet`
- `aws_subnet.private_b_subnet`
- `aws_subnet.public_a_subnet`
- `aws_subnet.public_b_subnet`
- `aws_vpc.application`
- `aws_vpc_endpoint.s3_endpoint`
- `aws_vpc_security_group_egress_rule.application_https_egress`
- `aws_vpc_security_group_ingress_rule.application_https_ingress`

## Policy provenance

- `s3_endpoint_policy`: `user/resource`; edges ``
- `trust_policy`: `generated/trust`; edges `edge_role_lambda`
