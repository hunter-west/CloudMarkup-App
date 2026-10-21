data "aws_iam_policy_document" "generated_read_policy" {
  statement {
    sid       = "generatedreadpolicy"
    effect    = "Allow"
    actions   = ["dynamodb:GetItem", "dynamodb:Query"]
    resources = [aws_dynamodb_table.notes_read_table.arn]
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

resource "aws_iam_role_policy" "generated_read_policy" {
  name   = "generated_read_policy"
  role   = aws_iam_role.notes_role.name
  policy = data.aws_iam_policy_document.generated_read_policy.json
}
