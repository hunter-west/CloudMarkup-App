resource "aws_instance" "instance" {
  ami                         = "ami-0123456789abcdef0"
  instance_type               = "t3.small"
  tenancy                     = "default"
  associate_public_ip_address = false
  monitoring                  = false
  subnet_id                   = aws_subnet.subnet_subnet.id
  vpc_security_group_ids      = [aws_security_group.group.id]
  iam_instance_profile        = aws_iam_instance_profile.profile.name
  credit_specification {
    cpu_credits = "standard"
  }
  metadata_options {
    http_tokens                 = "required"
    http_endpoint               = "enabled"
    http_protocol_ipv6          = "disabled"
    instance_metadata_tags      = "disabled"
    http_put_response_hop_limit = 1
  }
  root_block_device {
    volume_type           = "gp3"
    volume_size           = 30
    encrypted             = true
    iops                  = 3000
    throughput            = 125
    delete_on_termination = false
    kms_key_id            = aws_kms_key.application_key.arn
  }
  tags = local.tags
}
