# Synthetic Terraform plan fixtures

These fake `terraform show -json` projections contain only documentation-range
or explicitly synthetic identifiers. Tests pass them through the production
sanitizer before inspecting semantic changes. Raw addresses and all `before`,
`after`, sensitive, output, and variable values are excluded from retained
analysis.

The networking fixtures exercise structural review signals only. In particular,
the `aws_eip` case verifies the generic sanitized-plan network classification;
it does not claim that the Cloud Markup compiler creates an Elastic IP.
