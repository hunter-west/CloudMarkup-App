import { App } from "aws-cdk-lib";
import { BUNDLING_STACKS } from "aws-cdk-lib/cx-api";

// These assertions inspect templates, not bundle bytes. Real Lambda bundling is
// covered by lambda-bundling.test.ts and the production cdk:synth gate.
export function createTemplateTestApp(): App {
  return new App({ context: { [BUNDLING_STACKS]: [] } });
}
