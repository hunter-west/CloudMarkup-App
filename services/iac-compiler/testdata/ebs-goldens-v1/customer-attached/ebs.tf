resource "aws_volume_attachment" "attachment" {
  lifecycle {
    prevent_destroy = true
  }
  volume_id                      = aws_ebs_volume.volume.id
  instance_id                    = aws_instance.instance.id
  device_name                    = "/dev/sdf"
  force_detach                   = false
  skip_destroy                   = true
  stop_instance_before_detaching = false
}

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
  kms_key_id           = aws_kms_key.application_key.arn
  tags = merge(local.tags, {
    Name = "synthetic-data"
  })
}
