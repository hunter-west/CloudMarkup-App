resource "aws_security_group" "application" {
  name        = "application-lambda"
  description = "Lambda application traffic"
  vpc_id      = aws_vpc.application.id
  egress      = []
  tags        = local.tags
}

resource "aws_vpc_security_group_egress_rule" "application_https_egress" {
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
  description       = "Reviewed HTTPS egress"
  security_group_id = aws_security_group.application.id
}

resource "aws_vpc_security_group_ingress_rule" "application_https_ingress" {
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "10.20.0.0/16"
  description       = "HTTPS from the application VPC"
  security_group_id = aws_security_group.application.id
}

data "aws_iam_policy_document" "s3_endpoint_policy" {
  statement {
    sid       = "ApplicationObjectRead"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["arn:aws:s3:::company-private-bucket/object"]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::111122223333:role/application"]
    }
  }
}

data "aws_iam_policy_document" "trust_policy" {
  statement {
    sid     = "trustpolicy"
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

data "aws_partition" "current" {
}

resource "aws_iam_role_policy_attachment" "lambda_vpc_access" {
  role       = aws_iam_role.notes_role.name
  policy_arn = format("arn:%s:iam::aws:policy/%s", data.aws_partition.current.partition, "service-role/AWSLambdaVPCAccessExecutionRole")
}
