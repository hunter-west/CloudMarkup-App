// The designed resource with deployment key notes is a DynamoDB table.
// This repository instead declares an S3 bucket; neither side is auto-updated.
resource "aws_s3_bucket" "notes" {
  bucket = "synthetic-observed-notes"
}
