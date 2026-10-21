variable "aws_region" {
  type        = string
  description = "AWS Region selected by the immutable Architecture Document."
  default     = "us-east-1"
}

variable "notes_handler_artifact_path" {
  type        = string
  description = "Stable relative package output produced by the separate Prompt 32A workload builder."
  default     = "../application/artifacts/workload_notes/function.zip"
  validation {
    condition     = can(regex("^\\.\\.?/", var.notes_handler_artifact_path))
    error_message = "Package path must be repository-relative and begin with ./ or ../; absolute machine paths are forbidden."
  }
}
