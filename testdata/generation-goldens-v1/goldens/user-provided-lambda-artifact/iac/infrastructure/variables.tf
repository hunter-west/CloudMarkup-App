variable "aws_region" {
  type        = string
  description = "AWS Region selected by the immutable Architecture Document."
  default     = "us-east-1"
}

variable "notes_handler_artifact_base64sha256" {
  type        = string
  description = "Base64-encoded SHA-256 of the exact Lambda package."
  validation {
    condition     = can(regex("^[A-Za-z0-9+/]{43}=$", var.notes_handler_artifact_base64sha256))
    error_message = "Package digest must be one base64-encoded SHA-256 value."
  }
}

variable "notes_handler_artifact_path" {
  type        = string
  description = "Validated relative Lambda package path; absolute machine paths are forbidden by the artifact contract."
  validation {
    condition     = can(regex("^\\.\\.?/", var.notes_handler_artifact_path))
    error_message = "Package path must be repository-relative and begin with ./ or ../; absolute machine paths are forbidden."
  }
}
