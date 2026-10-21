resource "aws_dynamodb_table" "notes_table" {
  name                        = "notes"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "noteId"
  deletion_protection_enabled = true
  attribute {
    name = "noteId"
    type = "S"
  }
  point_in_time_recovery {
    enabled = true
  }
  server_side_encryption {
    enabled = true
  }
  tags = local.tags
}
