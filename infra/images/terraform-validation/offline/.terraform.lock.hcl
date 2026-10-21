# This file is maintained by the Cloud Markup image-context admission process.
# It binds the sole provider package admitted to the validation image.
provider "registry.terraform.io/hashicorp/aws" {
  version     = "6.63.0"
  constraints = ">= 6.55.0, < 7.0.0"
  hashes = [
    "h1:9cre7jh1lSs/9igpgAcENMUAUlYW3HCtkav3up4oit0=",
    "zh:4b357dfe4b820e3e4acd2881cff8288b2186491e63416751f0d12692ba478ceb",
  ]
}
