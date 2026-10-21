resource "aws_ebs_volume" "volume" {
  lifecycle {
    prevent_destroy = true
  }
  availability_zone    = "us-east-1a"
  size                 = 100
  type                 = "gp3"
  iops                 = 3000
  throughput           = 125
  encrypted            = true
  multi_attach_enabled = false
  tags = merge(local.tags, {
    Name = "synthetic-data"
  })
}
