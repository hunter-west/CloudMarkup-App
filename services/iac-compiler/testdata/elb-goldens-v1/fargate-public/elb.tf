resource "aws_lb" "alb" {
  lifecycle {
    prevent_destroy = true
  }
  tags                       = local.tags
  name                       = "synthetic-alb"
  internal                   = false
  load_balancer_type         = "application"
  ip_address_type            = "ipv4"
  idle_timeout               = 60
  enable_deletion_protection = true
  enable_http2               = true
  drop_invalid_header_fields = true
  desync_mitigation_mode     = "defensive"
  subnets                    = [aws_subnet.alb_subnet_a_subnet.id, aws_subnet.alb_subnet_b_subnet.id]
  security_groups            = [aws_security_group.alb_group.id]
  depends_on                 = [aws_internet_gateway.alb_igw, aws_route.alb_subnet_a, aws_route.alb_subnet_b]
}

resource "aws_lb_listener" "listener" {
  lifecycle {
    prevent_destroy = true
  }
  tags              = local.tags
  load_balancer_arn = aws_lb.alb.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.certificate_validation.certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.target.arn
  }
}

resource "aws_vpc_security_group_ingress_rule" "access_ingress" {
  security_group_id            = aws_security_group.group.id
  referenced_security_group_id = aws_security_group.alb_group.id
  ip_protocol                  = "tcp"
  from_port                    = 8080
  to_port                      = 8080
  description                  = "Exact synthetic ALB health/backend path"
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_vpc_security_group_egress_rule" "access_egress" {
  security_group_id            = aws_security_group.alb_group.id
  referenced_security_group_id = aws_security_group.group.id
  ip_protocol                  = "tcp"
  from_port                    = 8080
  to_port                      = 8080
  description                  = "Exact synthetic ALB health/backend path"
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_lb_target_group" "target" {
  lifecycle {
    prevent_destroy = true
  }
  tags                 = local.tags
  name                 = "synthetic-target"
  vpc_id               = aws_vpc.vpc.id
  port                 = 8080
  protocol             = "HTTP"
  protocol_version     = "HTTP1"
  target_type          = "ip"
  deregistration_delay = 60
  health_check {
    enabled             = true
    protocol            = "HTTP"
    port                = "traffic-port"
    path                = "/health"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 2
  }
}
