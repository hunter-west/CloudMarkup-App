resource "aws_rds_cluster_instance" "aurora_a" {
  identifier                   = "synthetic-aurora-a"
  instance_class               = "db.serverless"
  engine                       = "aurora-postgresql"
  cluster_identifier           = aws_rds_cluster.aurora_cluster.id
  engine_version               = aws_rds_cluster.aurora_cluster.engine_version
  db_subnet_group_name         = aws_db_subnet_group.db_subnets.name
  availability_zone            = "us-east-1a"
  promotion_tier               = 0
  ca_cert_identifier           = "rds-ca-rsa2048-g1"
  preferred_maintenance_window = "sun:03:00-sun:03:30"
  publicly_accessible          = false
  auto_minor_version_upgrade   = false
  apply_immediately            = false
  performance_insights_enabled = false
  monitoring_interval          = 0
  lifecycle {
    prevent_destroy = true
  }
  tags = local.tags
}

resource "aws_rds_cluster" "aurora_cluster" {
  cluster_identifier                  = "synthetic-aurora"
  engine_version                      = "16.6"
  database_name                       = "SyntheticApp"
  master_username                     = "SyntheticAdmin"
  preferred_backup_window             = "02:00-02:30"
  preferred_maintenance_window        = "sun:03:00-sun:03:30"
  engine                              = "aurora-postgresql"
  engine_mode                         = "provisioned"
  engine_lifecycle_support            = "open-source-rds-extended-support-disabled"
  storage_type                        = ""
  port                                = 5432
  backup_retention_period             = 7
  manage_master_user_password         = true
  storage_encrypted                   = true
  deletion_protection                 = true
  auto_minor_version_upgrade          = false
  allow_major_version_upgrade         = false
  apply_immediately                   = false
  iam_database_authentication_enabled = false
  enable_http_endpoint                = false
  skip_final_snapshot                 = false
  copy_tags_to_snapshot               = true
  final_snapshot_identifier           = "synthetic-aurora-final"
  serverlessv2_scaling_configuration {
    min_capacity = 0.5
    max_capacity = 4
  }
  db_subnet_group_name            = aws_db_subnet_group.db_subnets.name
  db_cluster_parameter_group_name = aws_rds_cluster_parameter_group.aurora_parameters.name
  vpc_security_group_ids          = [aws_security_group.group.id]
  lifecycle {
    prevent_destroy = true
  }
  tags = local.tags
}

resource "aws_rds_cluster_parameter_group" "aurora_parameters" {
  name        = "synthetic-aurora-tls"
  description = "Explicit synthetic Aurora TLS parameters"
  family      = "aurora-postgresql16"
  parameter {
    name         = "rds.force_ssl"
    value        = "1"
    apply_method = "pending-reboot"
  }
  lifecycle {
    prevent_destroy = true
  }
  tags = local.tags
}

resource "aws_db_subnet_group" "db_subnets" {
  name        = "synthetic-db-subnets"
  description = "Explicit synthetic database subnets"
  subnet_ids  = [aws_subnet.subnet_b_subnet.id, aws_subnet.subnet_subnet.id]
  lifecycle {
    prevent_destroy = true
  }
  tags = local.tags
}
