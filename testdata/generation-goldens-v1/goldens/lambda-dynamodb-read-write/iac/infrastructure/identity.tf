resource "aws_iam_role" "notes_role" {
  name                 = "notes-api-lambda-role"
  description          = "CloudMarkup notes-API Lambda execution role."
  max_session_duration = 3600
  assume_role_policy   = data.aws_iam_policy_document.trust_policy.json
  tags                 = local.tags
}
