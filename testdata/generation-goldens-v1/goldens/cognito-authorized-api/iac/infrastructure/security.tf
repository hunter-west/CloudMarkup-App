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

resource "aws_lambda_permission" "api_permission" {
  statement_id  = "apipermission"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.notes_handler.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = format("%s/$default/ANY/notes/*", aws_apigatewayv2_api.notes_api.execution_arn)
}
