terraform {
  required_version = ">= 1.13.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.55.0, < 7.0.0"
    }
  }
}

variable "aws_region" {
  description = "Reviewed AWS Region for this immutable revision."
  type        = string
  default     = "us-east-1"
}

variable "reviewed_nat_allocation_id" {
  description = "Existing reviewed Elastic IP allocation for the public NAT gateway."
  type        = string
}

resource "aws_vpc" "application" {
  cidr_block           = "10.20.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
}

resource "aws_subnet" "private_a" {
  availability_zone       = "us-east-1a"
  cidr_block              = "10.20.10.0/24"
  map_public_ip_on_launch = false
  vpc_id                  = aws_vpc.application.id
}

resource "aws_subnet" "private_b" {
  availability_zone       = "us-east-1b"
  cidr_block              = "10.20.11.0/24"
  map_public_ip_on_launch = false
  vpc_id                  = aws_vpc.application.id
}

resource "aws_subnet" "public_a" {
  availability_zone       = "us-east-1a"
  cidr_block              = "10.20.1.0/24"
  map_public_ip_on_launch = true
  vpc_id                  = aws_vpc.application.id
}

resource "aws_internet_gateway" "application" {
  vpc_id = aws_vpc.application.id
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.application.id
}

resource "aws_route" "public_default" {
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.application.id
  route_table_id         = aws_route_table.public.id
}

resource "aws_route_table_association" "public_a" {
  route_table_id = aws_route_table.public.id
  subnet_id      = aws_subnet.public_a.id
}

resource "aws_nat_gateway" "public_a" {
  allocation_id     = var.reviewed_nat_allocation_id
  connectivity_type = "public"
  subnet_id         = aws_subnet.public_a.id

  depends_on = [aws_internet_gateway.application]
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.application.id
}

resource "aws_route" "private_default" {
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.public_a.id
  route_table_id         = aws_route_table.private.id
}

resource "aws_route_table_association" "private_a" {
  route_table_id = aws_route_table.private.id
  subnet_id      = aws_subnet.private_a.id
}

resource "aws_route_table_association" "private_b" {
  route_table_id = aws_route_table.private.id
  subnet_id      = aws_subnet.private_b.id
}

resource "aws_security_group" "application" {
  description = "Reviewed Lambda application traffic"
  egress      = []
  name        = "application-lambda"
  vpc_id      = aws_vpc.application.id
}

resource "aws_vpc_security_group_egress_rule" "https" {
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  ip_protocol       = "tcp"
  security_group_id = aws_security_group.application.id
  to_port           = 443
}
