# Terraform semantic summary: cognito-authorized-api

- Artifact digest: `sha256:9abb08d19feae884b702e52eafc00d24497d17fc38ecfe543f1d00c447f82658`
- Generated files: 14
- Resources: 10
- Application artifact contracts: 1
- Policy artifacts: 2

## Resources

- `aws_apigatewayv2_api.notes_api`
- `aws_apigatewayv2_authorizer.notes_api_jwt`
- `aws_apigatewayv2_integration.notes_api_notes_handler_1ed4330357`
- `aws_apigatewayv2_route.notes_api_notes_handler_1ed4330357`
- `aws_apigatewayv2_stage.notes_api`
- `aws_cognito_user_pool.notes_pool`
- `aws_cognito_user_pool_client.notes_client`
- `aws_iam_role.notes_role`
- `aws_lambda_function.notes_handler`
- `aws_lambda_permission.api_permission`

## Policy provenance

- `api_permission`: `generated/service-grant`; edges `edge_api_lambda`
- `trust_policy`: `generated/trust`; edges `edge_role_lambda`
