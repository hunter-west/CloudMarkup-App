resource "aws_dynamodb_table" "shared_table_d59349d11e" {
  name                        = "alpha"
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

resource "aws_dynamodb_table" "shared_table_4042902ed9" {
  name                        = "beta"
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
