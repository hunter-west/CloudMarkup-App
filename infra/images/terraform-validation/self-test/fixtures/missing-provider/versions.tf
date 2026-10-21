terraform {
  required_version = ">= 1.13.0, < 2.0.0"

  required_providers {
    random = {
      source  = "hashicorp/random"
      version = "3.7.2"
    }
  }
}
