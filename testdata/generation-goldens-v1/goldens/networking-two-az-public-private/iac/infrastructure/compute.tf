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
  vpc_config {
    subnet_ids                  = [aws_subnet.private_a_subnet.id, aws_subnet.private_b_subnet.id]
    security_group_ids          = [aws_security_group.application.id]
    ipv6_allowed_for_dual_stack = false
  }
  depends_on = [aws_iam_role_policy_attachment.lambda_vpc_access]
  tags       = local.tags
}
