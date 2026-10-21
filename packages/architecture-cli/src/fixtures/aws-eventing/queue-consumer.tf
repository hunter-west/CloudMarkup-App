terraform {
  required_version = ">= 1.13.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.55.0, < 7.0.0"
    }
  }
}

variable "application_artifact_path" {
  description = "Prompt 45A application artifact path bound by the generation contract."
  type        = string
}

variable "application_artifact_sha256" {
  description = "Base64 SHA-256 of the immutable Prompt 45A application artifact."
  type        = string
}

resource "aws_sqs_queue" "work_dlq" {
  name                      = "work-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "work" {
  name                       = "work-queue"
  message_retention_seconds  = 345600
  receive_wait_time_seconds  = 20
  sqs_managed_sse_enabled    = true
  visibility_timeout_seconds = 60
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.work_dlq.arn
    maxReceiveCount     = 5
  })
}

resource "aws_iam_role" "consumer" {
  name = "queue-consumer-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "consumer_queue" {
  name = "queue-consumer-access"
  role = aws_iam_role.consumer.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes",
        "sqs:ReceiveMessage",
      ]
      Resource = aws_sqs_queue.work.arn
    }]
  })
}

resource "aws_lambda_function" "consumer" {
  function_name    = "queue-consumer"
  filename         = var.application_artifact_path
  source_code_hash = var.application_artifact_sha256
  handler          = "index.handler"
  role             = aws_iam_role.consumer.arn
  runtime          = "nodejs24.x"
  timeout          = 30
}

resource "aws_lambda_event_source_mapping" "work" {
  event_source_arn                   = aws_sqs_queue.work.arn
  function_name                      = aws_lambda_function.consumer.arn
  batch_size                         = 10
  maximum_batching_window_in_seconds = 5
  function_response_types            = ["ReportBatchItemFailures"]

  scaling_config {
    maximum_concurrency = 10
  }
}
