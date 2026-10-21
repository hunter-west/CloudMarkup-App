resource "aws_cloudfront_origin_access_control" "distribution_oac" {
  name                              = "cm-1a902f9300494e1e9c08bfb2"
  description                       = "Graph-owned read-only private S3 origin"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_cloudfront_distribution" "distribution" {
  lifecycle {
    prevent_destroy = true
  }
  comment             = "Synthetic public static delivery"
  enabled             = false
  is_ipv6_enabled     = true
  http_version        = "http2"
  price_class         = "PriceClass_100"
  default_root_object = "index.html"
  retain_on_delete    = true
  wait_for_deployment = true
  tags                = local.tags
  origin {
    domain_name              = aws_s3_bucket.origin.bucket_regional_domain_name
    origin_id                = "private-s3"
    origin_access_control_id = aws_cloudfront_origin_access_control.distribution_oac.id
  }
  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "private-s3"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true
    cache_policy_id        = aws_cloudfront_cache_policy.static_cache.id
  }
  restrictions {
    geo_restriction {
      restriction_type = "none"
      locations        = []
    }
  }
  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

resource "aws_cloudfront_cache_policy" "static_cache" {
  lifecycle {
    prevent_destroy = true
  }
  name        = "StaticExample"
  comment     = "Synthetic bounded static cache"
  min_ttl     = 0
  default_ttl = 300
  max_ttl     = 3600
  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
  }
}
