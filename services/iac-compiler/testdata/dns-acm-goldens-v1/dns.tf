resource "aws_acm_certificate" "certificate" {
  tags              = local.tags
  domain_name       = "app.example.test"
  region            = "us-east-1"
  validation_method = "DNS"
  key_algorithm     = "RSA_2048"
  options {
    certificate_transparency_logging_preference = "ENABLED"
    export                                      = "DISABLED"
  }
  lifecycle {
    prevent_destroy       = true
    create_before_destroy = true
  }
}

resource "aws_route53_record" "certificate_dns_validation" {
  zone_id         = aws_route53_zone.public_zone.zone_id
  name            = one(aws_acm_certificate.certificate.domain_validation_options).resource_record_name
  type            = one(aws_acm_certificate.certificate.domain_validation_options).resource_record_type
  records         = [one(aws_acm_certificate.certificate.domain_validation_options).resource_record_value]
  ttl             = 60
  allow_overwrite = false
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_acm_certificate_validation" "certificate_validation" {
  region                  = "us-east-1"
  certificate_arn         = aws_acm_certificate.certificate.arn
  validation_record_fqdns = [aws_route53_record.certificate_dns_validation.fqdn]
}

resource "aws_route53_zone" "public_zone" {
  tags          = local.tags
  name          = "example.test"
  comment       = "Synthetic public DNS authority"
  force_destroy = false
  lifecycle {
    prevent_destroy = true
  }
}
