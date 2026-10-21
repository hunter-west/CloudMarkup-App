resource "aws_cloudwatch_metric_alarm" "notes_alarm" {
  alarm_name          = "notes-api-errors"
  alarm_description   = "CloudMarkup notes-API Lambda error alarm."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  datapoints_to_alarm = 1
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 60
  statistic           = "Sum"
  threshold           = 1
  treat_missing_data  = "notBreaching"
  dimensions = {
    FunctionName = aws_lambda_function.notes_handler.function_name
  }
  tags = local.tags
}

resource "aws_cloudwatch_log_group" "notes_logs" {
  name              = "/aws/lambda/notes-api-handler"
  log_group_class   = "STANDARD"
  retention_in_days = 30
  lifecycle {
    prevent_destroy = true
  }
  tags = local.tags
}
