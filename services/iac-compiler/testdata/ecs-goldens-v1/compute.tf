resource "aws_ecs_cluster" "cluster" {
  name = "SyntheticCluster"
  setting {
    name  = "containerInsights"
    value = "disabled"
  }
  tags = local.tags
}

resource "aws_ecr_repository" "repository" {
  name                 = "synthetic/application"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = false
  encryption_configuration {
    encryption_type = "AES256"
  }
  image_scanning_configuration {
    scan_on_push = true
  }
  lifecycle {
    prevent_destroy = true
  }
  tags = local.tags
}

resource "aws_ecs_service" "service" {
  name                               = "SyntheticService"
  cluster                            = aws_ecs_cluster.cluster.arn
  task_definition                    = aws_ecs_task_definition.task.arn
  desired_count                      = 1
  launch_type                        = "FARGATE"
  platform_version                   = "1.4.0"
  scheduling_strategy                = "REPLICA"
  availability_zone_rebalancing      = "DISABLED"
  enable_execute_command             = false
  enable_ecs_managed_tags            = false
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  deployment_controller {
    type = "ECS"
  }
  network_configuration {
    assign_public_ip = false
    subnets          = [aws_subnet.subnet_subnet.id]
    security_groups  = [aws_security_group.group.id]
  }
  tags = local.tags
}

resource "aws_ecs_task_definition" "task" {
  family                   = "SyntheticTask"
  cpu                      = "256"
  memory                   = "512"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  track_latest             = false
  skip_destroy             = false
  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }
  execution_role_arn = aws_iam_role.execution_role.arn
  task_role_arn      = aws_iam_role.application_role.arn
  depends_on         = [aws_iam_role_policy_attachment.execution_attachment, aws_iam_role_policy.secret_access]
  container_definitions = jsonencode([{
    "essential" = true
    "healthCheck" = {
      "command"     = ["CMD", "/app/health"]
      "interval"    = 30
      "retries"     = 3
      "startPeriod" = 0
      "timeout"     = 5
    }
    "image" = format("%s@%s", aws_ecr_repository.repository.repository_url, "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    "logConfiguration" = {
      "logDriver" = "awslogs"
      "options" = {
        "awslogs-group"         = aws_cloudwatch_log_group.logs.name
        "awslogs-region"        = "us-east-1"
        "awslogs-stream-prefix" = "Application"
        "max-buffer-size"       = "10m"
        "mode"                  = "non-blocking"
      }
    }
    "name" = "Application"
    "portMappings" = [{
      "containerPort" = 8080
      "hostPort"      = 8080
      "protocol"      = "tcp"
    }]
    "readonlyRootFilesystem" = true
    "secrets" = [{
      "name"      = "DATABASE_PASSWORD"
      "valueFrom" = aws_secretsmanager_secret.application_secret.arn
    }]
    "user" = "10001:10001"
  }])
  tags = local.tags
}
