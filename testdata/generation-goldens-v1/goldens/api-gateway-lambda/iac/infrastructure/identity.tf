resource "aws_cognito_user_pool_client" "notes_client" {
  name                          = "notes-web"
  user_pool_id                  = aws_cognito_user_pool.notes_pool.id
  generate_secret               = false
  prevent_user_existence_errors = "ENABLED"
  explicit_auth_flows           = ["ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_SRP_AUTH"]
  access_token_validity         = 15
  id_token_validity             = 15
  refresh_token_validity        = 30
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

resource "aws_cognito_user_pool" "notes_pool" {
  name                     = "notes-users"
  mfa_configuration        = "OPTIONAL"
  deletion_protection      = "ACTIVE"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  admin_create_user_config {
    allow_admin_create_user_only = true
  }
  username_configuration {
    case_sensitive = false
  }
  password_policy {
    minimum_length    = 12
    require_lowercase = true
    require_numbers   = true
    require_symbols   = true
    require_uppercase = true
  }
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
  software_token_mfa_configuration {
    enabled = true
  }
  tags = local.tags
}

resource "aws_iam_role" "notes_role" {
  name                 = "notes-api-lambda-role"
  description          = "CloudMarkup notes-API Lambda execution role."
  max_session_duration = 3600
  assume_role_policy   = data.aws_iam_policy_document.trust_policy.json
  tags                 = local.tags
}
