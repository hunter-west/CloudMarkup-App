resource "aws_apigatewayv2_api" "notes_api" {
  name          = "notes-api"
  description   = "CloudMarkup authenticated notes HTTP API."
  protocol_type = "HTTP"
  tags          = local.tags
}

resource "aws_lambda_function" "notes_handler" {
  function_name                  = "notes-api-handler"
  description                    = "CloudMarkup notes-API workload."
  role                           = aws_iam_role.notes_role.arn
  handler                        = "index.handler"
  runtime                        = "nodejs24.x"
  architectures                  = ["arm64"]
  memory_size                    = 256
  reserved_concurrent_executions = 10
  timeout                        = 10
  filename                       = var.notes_handler_artifact_path
  source_code_hash               = filebase64sha256(var.notes_handler_artifact_path)
  tracing_config {
    mode = "Active"
  }
  tags = local.tags
}

resource "aws_apigatewayv2_authorizer" "notes_api_jwt" {
  api_id           = aws_apigatewayv2_api.notes_api.id
  authorizer_type  = "JWT"
  name             = "notesJwt"
  identity_sources = ["$request.header.Authorization"]
  jwt_configuration {
    audience = [aws_cognito_user_pool_client.notes_client.id]
    issuer   = format("https://%s", aws_cognito_user_pool.notes_pool.endpoint)
  }
}

resource "aws_apigatewayv2_stage" "notes_api" {
  api_id      = aws_apigatewayv2_api.notes_api.id
  name        = "$default"
  auto_deploy = true
  tags        = local.tags
}

resource "aws_apigatewayv2_integration" "notes_api_notes_handler_1ed4330357" {
  api_id                 = aws_apigatewayv2_api.notes_api.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.notes_handler.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 10000
}

resource "aws_apigatewayv2_route" "notes_api_notes_handler_1ed4330357" {
  api_id             = aws_apigatewayv2_api.notes_api.id
  route_key          = "ANY /notes/{proxy+}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.notes_api_jwt.id
  target             = format("integrations/%s", aws_apigatewayv2_integration.notes_api_notes_handler_1ed4330357.id)
}
