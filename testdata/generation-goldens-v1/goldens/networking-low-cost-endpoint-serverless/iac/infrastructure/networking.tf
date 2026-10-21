resource "aws_vpc" "application" {
  cidr_block           = "10.20.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  instance_tenancy     = "default"
  tags                 = local.tags
}

resource "aws_route_table_association" "private_a_association" {
  route_table_id = aws_route_table.private_a_routes.id
  subnet_id      = aws_subnet.private_a_subnet.id
}

resource "aws_route_table" "private_a_routes" {
  vpc_id = aws_vpc.application.id
  tags = merge(local.tags, {
    Name = "private_a-routes"
  })
}

resource "aws_subnet" "private_a_subnet" {
  vpc_id                          = aws_vpc.application.id
  availability_zone               = "us-east-1a"
  cidr_block                      = "10.20.10.0/24"
  map_public_ip_on_launch         = false
  assign_ipv6_address_on_creation = false
  tags                            = local.tags
}

resource "aws_route_table_association" "private_b_association" {
  route_table_id = aws_route_table.private_b_routes.id
  subnet_id      = aws_subnet.private_b_subnet.id
}

resource "aws_route_table" "private_b_routes" {
  vpc_id = aws_vpc.application.id
  tags = merge(local.tags, {
    Name = "private_b-routes"
  })
}

resource "aws_subnet" "private_b_subnet" {
  vpc_id                          = aws_vpc.application.id
  availability_zone               = "us-east-1b"
  cidr_block                      = "10.20.11.0/24"
  map_public_ip_on_launch         = false
  assign_ipv6_address_on_creation = false
  tags                            = local.tags
}

resource "aws_vpc_endpoint" "s3_endpoint" {
  vpc_id            = aws_vpc.application.id
  service_name      = format("com.amazonaws.%s.s3", var.aws_region)
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private_a_routes.id, aws_route_table.private_b_routes.id]
  policy            = data.aws_iam_policy_document.s3_endpoint_policy.json
  tags              = local.tags
}
