resource "aws_db_instance" "database" {
  identifier                          = "synthetic-postgres"
  engine_version                      = "16.6"
  instance_class                      = "db.t4g.small"
  db_name                             = "SyntheticApp"
  username                            = "SyntheticAdmin"
  backup_window                       = "02:00-02:30"
  maintenance_window                  = "sun:03:00-sun:03:30"
  ca_cert_identifier                  = "rds-ca-rsa2048-g1"
  allocated_storage                   = 30
  backup_retention_period             = 7
  port                                = 5432
  monitoring_interval                 = 0
  multi_az                            = false
  engine                              = "postgres"
  storage_type                        = "gp3"
  engine_lifecycle_support            = "open-source-rds-extended-support-disabled"
  manage_master_user_password         = true
  storage_encrypted                   = true
  publicly_accessible                 = false
  deletion_protection                 = true
  auto_minor_version_upgrade          = false
  allow_major_version_upgrade         = false
  iam_database_authentication_enabled = false
  performance_insights_enabled        = false
  apply_immediately                   = false
  skip_final_snapshot                 = false
  delete_automated_backups            = false
  copy_tags_to_snapshot               = true
  final_snapshot_identifier           = "synthetic-postgres-final"
  db_subnet_group_name                = aws_db_subnet_group.db_subnets.name
  parameter_group_name                = aws_db_parameter_group.db_parameters.name
  vpc_security_group_ids              = [aws_security_group.group.id]
  lifecycle {
    prevent_destroy = true
  }
  tags = local.tags
}

resource "aws_db_parameter_group" "db_parameters" {
  name        = "synthetic-postgres-tls"
  description = "Explicit synthetic TLS parameters"
  family      = "postgres16"
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
