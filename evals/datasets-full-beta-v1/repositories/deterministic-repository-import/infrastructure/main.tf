resource "aws_dynamodb_table" "notes" {
  name         = "synthetic-notes"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "noteId"

  attribute {
    name = "noteId"
    type = "S"
  }

  point_in_time_recovery { enabled = true }
  server_side_encryption { enabled = true }
}
