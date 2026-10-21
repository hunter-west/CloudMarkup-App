import { Aspects, Stage, Tags, type StageProps } from "aws-cdk-lib";
import type { Construct } from "constructs";

import {
  betaRuntimePermissionsBoundary,
  createBetaStackSynthesizer,
} from "../beta-deployment-bootstrap.js";
import { PlatformSecurityAspect } from "../compliance/platform-security-aspect.js";
import type { EnvironmentConfig } from "../config/environment-config.js";
import { createPlatformResourceNames } from "../platform-names.js";
import { ApplicationStack } from "../stacks/application-stack.js";
import { EdgeStack } from "../stacks/edge-stack.js";
import { ObservabilityStack } from "../stacks/observability-stack.js";
import { StatefulStack } from "../stacks/stateful-stack.js";

export interface CloudMarkupStageProps extends StageProps {
  readonly config: EnvironmentConfig;
  readonly webAssetsPath?: string;
}

/** Acyclic capability/lifecycle topology for one CloudMarkup environment. */
export class CloudMarkupStage extends Stage {
  public readonly application: ApplicationStack;
  public readonly edge: EdgeStack;
  public readonly observability: ObservabilityStack;
  public readonly stateful: StatefulStack;

  public constructor(
    scope: Construct,
    id: string,
    props: CloudMarkupStageProps,
  ) {
    const { config, webAssetsPath, ...stageProps } = props;
    super(scope, id, {
      ...stageProps,
      env: config.target,
      ...(config.environment === "beta"
        ? { permissionsBoundary: betaRuntimePermissionsBoundary() }
        : {}),
    });

    const names = createPlatformResourceNames(
      config.environment,
      config.target,
    );
    const stackEnvironment = () => ({
      env: config.target,
      ...(config.environment === "beta"
        ? { synthesizer: createBetaStackSynthesizer() }
        : {}),
      terminationProtection: config.lifecycle.deletionProtection,
    });
    this.observability = new ObservabilityStack(this, "Observability", {
      ...stackEnvironment(),
      config,
      description:
        "CloudMarkup logs, Regional and CloudFront WAF metrics and alarms, dashboard, and notification interface.",
      names,
      stackName: `${names.prefix}-observability`,
    });
    this.stateful = new StatefulStack(this, "Stateful", {
      ...stackEnvironment(),
      config,
      description:
        "CloudMarkup PostgreSQL metadata, generated origin verification, and private versioned object storage.",
      names,
      stackName: `${names.prefix}-stateful`,
    });
    this.stateful.addStackDependency(
      this.observability,
      "Create retained database log groups before Aurora exports logs.",
    );
    this.application = new ApplicationStack(this, "Application", {
      ...stackEnvironment(),
      config,
      description:
        "CloudMarkup identity, Regional REST API with feature-gated pre-invocation WAF origin admission, safe runtime seams, queues, and job dispatch.",
      names,
      observability: this.observability,
      stackName: `${names.prefix}-application`,
      stateful: this.stateful,
    });
    this.application.addStackDependency(this.observability);
    this.application.addStackDependency(this.stateful);
    this.edge = new EdgeStack(this, "Edge", {
      ...stackEnvironment(),
      application: this.application,
      config,
      description:
        "CloudMarkup private web origin, same-origin CloudFront distribution, and feature-gated global rate controls.",
      names,
      stackName: `${names.prefix}-edge`,
      stateful: this.stateful,
      ...(webAssetsPath === undefined ? {} : { webAssetsPath }),
    });
    this.edge.addStackDependency(this.application);
    this.edge.addStackDependency(this.stateful);

    for (const stack of [
      this.observability,
      this.stateful,
      this.application,
      this.edge,
    ]) {
      Aspects.of(stack).add(new PlatformSecurityAspect());
      Tags.of(stack).add(
        "CloudMarkupConfigSchema",
        String(config.schemaVersion),
      );
      for (const [key, value] of Object.entries(config.tags)) {
        Tags.of(stack).add(key, value);
      }
    }
  }
}
