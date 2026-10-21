import { defineProviderValidationRuleDescriptorV1 } from "@cloudmarkup/provider-sdk";
import {
  dnsRuleId,
  dnsDocumentation,
  dnsProperties,
} from "../services/dns-acm.js";
export const dnsReadinessValidationRuleDescriptor =
  defineProviderValidationRuleDescriptorV1({
    id: dnsRuleId,
    interfaceVersion: 1,
    ruleVersion: "1.0.0",
    implementationId: dnsRuleId + ".evaluate",
    serviceIds: Object.keys(dnsProperties),
    documentation: dnsDocumentation,
  });
