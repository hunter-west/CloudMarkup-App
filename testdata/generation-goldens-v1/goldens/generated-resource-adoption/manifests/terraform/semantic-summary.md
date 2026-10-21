# Terraform semantic summary: generated-resource-adoption

- Artifact digest: `sha256:a6db95f0058121bdaed4d55ef1825e53c5129d4eabd5870cae6068a0cdcbe851`
- Generated files: 14
- Resources: 18
- Application artifact contracts: 1
- Policy artifacts: 6

## Resources

- `aws_apigatewayv2_api.notes_api`
- `aws_apigatewayv2_authorizer.notes_api_jwt`
- `aws_apigatewayv2_integration.notes_api_notes_handler_1ed4330357`
- `aws_apigatewayv2_route.notes_api_notes_handler_1ed4330357`
- `aws_apigatewayv2_stage.notes_api`
- `aws_cloudwatch_log_group.notes_logs`
- `aws_cloudwatch_metric_alarm.notes_alarm`
- `aws_cognito_user_pool.notes_pool`
- `aws_cognito_user_pool_client.notes_client`
- `aws_dynamodb_table.notes_table`
- `aws_iam_role.notes_role`
- `aws_iam_role_policy.custom_policy`
- `aws_iam_role_policy.generated_logs_policy`
- `aws_iam_role_policy.generated_read_policy`
- `aws_iam_role_policy.generated_write_policy`
- `aws_iam_role_policy_attachment.managed_policy`
- `aws_lambda_function.notes_handler`
- `aws_lambda_permission.api_permission`

## Policy provenance

- `api_permission`: `generated/service-grant`; edges `edge_api_lambda`
- `custom_policy`: `user/identity-inline`; edges ``
- `generated_logs_policy`: `generated/generated-permission`; edges `edge_lambda_logs`
- `generated_read_policy`: `generated/generated-permission`; edges `edge_lambda_reads`
- `generated_write_policy`: `generated/generated-permission`; edges `edge_lambda_writes`
- `trust_policy`: `generated/trust`; edges `edge_role_lambda`
