terraform {
  required_version = ">= 1.13.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.55.0, < 7.0.0"
    }
  }
}

variable "aws_region" {
  type = string
}

provider "aws" {
  region = var.aws_region
}
