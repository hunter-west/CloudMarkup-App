data "aws_iam_policy_document" "custom_policy" {
  statement {
    sid       = "custompolicy"
    effect    = "Allow"
    actions   = ["dynamodb:GetItem"]
    resources = [aws_dynamodb_table.notes_table.arn]
  }
}

data "aws_iam_policy_document" "generated_logs_policy" {
  statement {
    sid       = "generatedlogspolicy"
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = [format("%s:*", aws_cloudwatch_log_group.notes_logs.arn)]
  }
}

data "aws_iam_policy_document" "generated_write_policy" {
  statement {
    sid       = "generatedwritepolicy"
    effect    = "Allow"
    actions   = ["dynamodb:DeleteItem", "dynamodb:PutItem", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.notes_table.arn]
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

resource "aws_iam_role_policy" "custom_policy" {
  name   = "custom_policy"
  role   = aws_iam_role.notes_role.name
  policy = data.aws_iam_policy_document.custom_policy.json
}

resource "aws_iam_role_policy" "generated_logs_policy" {
  name   = "generated_logs_policy"
  role   = aws_iam_role.notes_role.name
  policy = data.aws_iam_policy_document.generated_logs_policy.json
}

resource "aws_iam_role_policy" "generated_write_policy" {
  name   = "generated_write_policy"
  role   = aws_iam_role.notes_role.name
  policy = data.aws_iam_policy_document.generated_write_policy.json
}

data "aws_partition" "current" {
}

resource "aws_iam_role_policy_attachment" "managed_policy" {
  role       = aws_iam_role.notes_role.name
  policy_arn = format("arn:%s:iam::aws:policy/%s", data.aws_partition.current.partition, "AWSXRayDaemonWriteAccess")
}

resource "aws_lambda_permission" "api_permission" {
  statement_id  = "apipermission"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.notes_handler.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = format("%s/$default/ANY/notes/*", aws_apigatewayv2_api.notes_api.execution_arn)
}
