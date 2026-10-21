output "vpc_id" {
  description = "Architecture output vpc_id."
  value       = aws_vpc.application.id
}

output "private_subnet_a_id" {
  description = "Architecture output private_subnet_a_id."
  value       = aws_subnet.private_a_subnet.id
}
