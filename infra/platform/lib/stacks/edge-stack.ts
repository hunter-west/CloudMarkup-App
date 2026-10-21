import {
  CfnOutput,
  Duration,
  Fn,
  RemovalPolicy,
  Stack,
  type StackProps,
  aws_certificatemanager as acm,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_iam as iam,
  aws_route53 as route53,
  aws_route53_targets as route53Targets,
  aws_s3 as s3,
  aws_s3_deployment as s3deployment,
  aws_wafv2 as wafv2,
} from "aws-cdk-lib";
import type { Construct } from "constructs";

import type { EnvironmentConfig } from "../config/environment-config.js";
import { BETA_CDK_BOOTSTRAP } from "../beta-deployment-bootstrap.js";
import { EDGE_ORIGIN_HEADER_NAME } from "../edge-origin-contract.js";
import type { PlatformResourceNames } from "../platform-names.js";
import type { ApplicationStack } from "./application-stack.js";
import type { StatefulStack } from "./stateful-stack.js";

export interface EdgeStackProps extends StackProps {
  readonly application: ApplicationStack;
  readonly config: EnvironmentConfig;
  readonly names: PlatformResourceNames;
  readonly stateful: StatefulStack;
  readonly webAssetsPath?: string;
}

function rateControlRule(
  name: string,
  priority: number,
  limit: number,
  pathPrefix: string,
): wafv2.CfnWebACL.RuleProperty {
  return {
    action: { block: { customResponse: { responseCode: 429 } } },
    name,
    priority,
    statement: {
      rateBasedStatement: {
        aggregateKeyType: "IP",
        evaluationWindowSec: 300,
        limit,
        scopeDownStatement: {
          byteMatchStatement: {
            fieldToMatch: { uriPath: {} },
            positionalConstraint: "STARTS_WITH",
            searchString: pathPrefix,
            textTransformations: [{ priority: 0, type: "NONE" }],
          },
        },
      },
    },
    visibilityConfig: {
      cloudWatchMetricsEnabled: true,
      metricName: name,
      sampledRequestsEnabled: false,
    },
  };
}

/** Private SPA origin plus same-origin, non-cached API forwarding. */
export class EdgeStack extends Stack {
  public readonly distribution: cloudfront.Distribution;
  public readonly webAssetsDeployment?: s3deployment.BucketDeployment;
  public readonly webAssetsBucket: s3.Bucket;

  public constructor(scope: Construct, id: string, props: EdgeStackProps) {
    super(scope, id, props);

    const webAssetsDeploymentRole =
      props.config.environment === "beta"
        ? iam.Role.fromRoleArn(
            this,
            "BetaWebDeploymentRuntimeRole",
            this.formatArn({
              region: "",
              resource: "role",
              resourceName: BETA_CDK_BOOTSTRAP.webDeploymentRuntimeRoleName,
              service: "iam",
            }),
            { mutable: false },
          )
        : undefined;
    const removalPolicy =
      props.config.lifecycle.removalPolicy === "retain"
        ? RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE
        : RemovalPolicy.DESTROY;
    this.webAssetsBucket = new s3.Bucket(this, "WebAssets", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      bucketName: props.names.webAssetsBucket,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [
        {
          id: "RetireOldWebAssetVersions",
          noncurrentVersionExpiration: Duration.days(
            props.config.retention.noncurrentObjectVersionsDays,
          ),
        },
      ],
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy,
      serverAccessLogsBucket: props.stateful.accessLogBucket,
      serverAccessLogsPrefix: "web-assets/",
      versioned: true,
    });

    const customHeadersBehavior = {
      customHeaders: [
        { header: "Cache-Control", override: true, value: "no-store" },
        {
          header: "Cross-Origin-Opener-Policy",
          override: true,
          value: "same-origin",
        },
        {
          header: "Cross-Origin-Resource-Policy",
          override: true,
          value: "same-origin",
        },
        {
          header: "Permissions-Policy",
          override: true,
          value:
            "camera=(), display-capture=(), geolocation=(), microphone=(), payment=(), usb=()",
        },
        {
          header: "X-Permitted-Cross-Domain-Policies",
          override: true,
          value: "none",
        },
      ],
    };
    const commonSecurityHeaders = {
      contentTypeOptions: { override: true },
      frameOptions: {
        frameOption: cloudfront.HeadersFrameOption.DENY,
        override: true,
      },
      referrerPolicy: {
        override: true,
        referrerPolicy:
          cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
      },
      strictTransportSecurity: {
        accessControlMaxAge: Duration.days(365),
        includeSubdomains: true,
        override: true,
        preload: true,
      },
      xssProtection: {
        modeBlock: true,
        override: true,
        protection: true,
      },
    };
    const cognitoManagedLoginOrigin = `https://${props.names.userPoolDomainPrefix}.auth.${props.config.target.region}.amazoncognito.com`;
    const betaEdgeResources = props.config.environment === "beta";
    const webSecurityHeaders = {
      ...commonSecurityHeaders,
      contentSecurityPolicy: {
        contentSecurityPolicy: `default-src 'self'; base-uri 'none'; child-src 'none'; connect-src 'self' ${cognitoManagedLoginOrigin}; font-src 'self'; form-action 'self'; frame-ancestors 'none'; frame-src 'none'; img-src 'self' data: blob:; manifest-src 'self'; media-src 'none'; object-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; worker-src 'self' blob:; upgrade-insecure-requests`,
        override: true,
      },
    };
    const securityHeaders = betaEdgeResources
      ? cloudfront.ResponseHeadersPolicy.fromResponseHeadersPolicyId(
          this,
          "ImportedSecurityHeaders",
          Fn.importValue(BETA_CDK_BOOTSTRAP.securityHeadersPolicyIdExportName),
        )
      : new cloudfront.ResponseHeadersPolicy(this, "SecurityHeaders", {
          customHeadersBehavior,
          responseHeadersPolicyName: `${props.names.prefix}-security-headers`,
          securityHeadersBehavior: webSecurityHeaders,
        });
    const publicAssetHeaders = betaEdgeResources
      ? cloudfront.ResponseHeadersPolicy.fromResponseHeadersPolicyId(
          this,
          "ImportedPublicAssetHeaders",
          Fn.importValue(
            BETA_CDK_BOOTSTRAP.publicAssetHeadersPolicyIdExportName,
          ),
        )
      : new cloudfront.ResponseHeadersPolicy(this, "PublicAssetHeaders", {
          customHeadersBehavior: {
            customHeaders: customHeadersBehavior.customHeaders.map((header) =>
              header.header === "Cache-Control"
                ? { ...header, value: "public, max-age=31536000, immutable" }
                : header,
            ),
          },
          responseHeadersPolicyName: `${props.names.prefix}-public-asset-headers`,
          securityHeadersBehavior: webSecurityHeaders,
        });
    const apiSecurityHeaders = betaEdgeResources
      ? cloudfront.ResponseHeadersPolicy.fromResponseHeadersPolicyId(
          this,
          "ImportedApiSecurityHeaders",
          Fn.importValue(
            BETA_CDK_BOOTSTRAP.apiSecurityHeadersPolicyIdExportName,
          ),
        )
      : new cloudfront.ResponseHeadersPolicy(this, "ApiSecurityHeaders", {
          customHeadersBehavior: {
            customHeaders: customHeadersBehavior.customHeaders.map((header) =>
              header.header === "Cache-Control"
                ? { ...header, override: false }
                : header,
            ),
          },
          responseHeadersPolicyName: `${props.names.prefix}-api-security-headers`,
          // API routes own response-specific Cache-Control, CSP, and
          // Referrer-Policy. In particular, solution ZIP downloads require the
          // origin's exact values for the browser integrity check, so CloudFront
          // may supply safe defaults but must not replace those headers.
          securityHeadersBehavior: {
            ...commonSecurityHeaders,
            contentTypeOptions: { override: false },
            referrerPolicy: {
              override: false,
              referrerPolicy:
                cloudfront.HeadersReferrerPolicy
                  .STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
            },
          },
        });
    const webOriginAccessControl = betaEdgeResources
      ? cloudfront.S3OriginAccessControl.fromOriginAccessControlId(
          this,
          "ImportedWebOriginAccessControl",
          Fn.importValue(BETA_CDK_BOOTSTRAP.webOriginAccessControlIdExportName),
        )
      : undefined;
    const stripApiPrefix = new cloudfront.Function(this, "StripApiPrefix", {
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  if (request.uri === '/api') {
    request.uri = '/';
  } else if (request.uri.indexOf('/api/') === 0) {
    request.uri = request.uri.substring(4);
  }
  return request;
}`),
      comment: "Remove the browser-only /api prefix before HTTP API routing",
      functionName: `${props.names.prefix}-strip-api-prefix`,
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });
    const routeSpaRequest = new cloudfront.Function(this, "RouteSpaRequest", {
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var lastSlash = uri.lastIndexOf('/');
  var lastSegment = uri.substring(lastSlash + 1);
  if (
    uri.charAt(uri.length - 1) === '/' || lastSegment.indexOf('.') === -1
  ) {
    request.uri = '/index.html';
  }
  return request;
}`),
      comment:
        "Map extensionless SPA routes to index.html without affecting /api/*",
      functionName: `${props.names.prefix}-spa-routes`,
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });

    const domain = props.config.domain;
    const certificate =
      domain === undefined
        ? undefined
        : acm.Certificate.fromCertificateArn(
            this,
            "Certificate",
            domain.certificateArn,
          );
    const apiOriginDomain = `${props.application.api.restApiId}.execute-api.${this.region}.${this.urlSuffix}`;
    const edgeOriginVerification =
      props.stateful.edgeOriginVerificationSecret.secretValue.unsafeUnwrap();
    const ownedWebAcl =
      props.config.features.waf && domain?.wafWebAclArn === undefined
        ? new wafv2.CfnWebACL(this, "EdgeRateControls", {
            defaultAction: { allow: {} },
            description:
              "CloudMarkup controlled-beta CloudFront API and webhook rate controls",
            name: `${props.names.prefix}-edge-rate-controls`,
            rules: [
              rateControlRule(
                "WebhookRateControl",
                0,
                props.config.limits.wafWebhookRequestsPerFiveMinutes,
                "/api/webhooks/",
              ),
              rateControlRule(
                "ApiRateControl",
                1,
                props.config.limits.wafApiRequestsPerFiveMinutes,
                "/api/",
              ),
            ],
            scope: "CLOUDFRONT",
            visibilityConfig: {
              cloudWatchMetricsEnabled: true,
              metricName: `${props.names.prefix}-edge-rate-controls`,
              sampledRequestsEnabled: false,
            },
          })
        : undefined;
    const webAclId = props.config.features.waf
      ? (domain?.wafWebAclArn ?? ownedWebAcl?.attrArn)
      : undefined;
    const webOrigin = origins.S3BucketOrigin.withOriginAccessControl(
      this.webAssetsBucket,
      webOriginAccessControl === undefined
        ? undefined
        : { originAccessControl: webOriginAccessControl },
    );
    // Vite emits eight-character content hashes. Only these public JS/CSS
    // bundles are immutable; HTML, stable public filenames and /api/* retain
    // their existing policies. No SPA rewrite runs on bundle requests.
    const publicAssetBehavior: cloudfront.BehaviorOptions = {
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      compress: true,
      origin: webOrigin,
      responseHeadersPolicy: publicAssetHeaders,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    };
    this.distribution = new cloudfront.Distribution(this, "Distribution", {
      additionalBehaviors: {
        "/api/*": {
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          // API responses carry strong ETags used for optimistic concurrency.
          // CloudFront can weaken them when it transforms a compressed body.
          compress: false,
          functionAssociations: [
            {
              eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
              function: stripApiPrefix,
            },
          ],
          origin: new origins.HttpOrigin(apiOriginDomain, {
            customHeaders: {
              [EDGE_ORIGIN_HEADER_NAME]: edgeOriginVerification,
            },
            originPath: `/${props.application.apiStage.stageName}`,
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
          }),
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: apiSecurityHeaders,
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
        "/assets/*-????????.js": publicAssetBehavior,
        "/assets/*-????????.css": publicAssetBehavior,
      },
      certificate,
      comment: `CloudMarkup ${props.config.environment} same-origin edge`,
      defaultBehavior: {
        compress: true,
        functionAssociations: [
          {
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
            function: routeSpaRequest,
          },
        ],
        origin: webOrigin,
        responseHeadersPolicy: securityHeaders,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: "index.html",
      domainNames: domain === undefined ? undefined : [domain.domainName],
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      webAclId,
    });

    if (
      props.config.environment === "beta" &&
      props.webAssetsPath === undefined
    ) {
      throw new TypeError(
        "The beta platform requires a built web asset directory.",
      );
    }
    if (props.webAssetsPath !== undefined) {
      if (
        props.config.environment === "beta" &&
        webAssetsDeploymentRole === undefined
      ) {
        throw new TypeError(
          "The beta web deployment requires a bootstrap-owned runtime role.",
        );
      }
      this.webAssetsDeployment = new s3deployment.BucketDeployment(
        this,
        "DeployWebAssets",
        {
          destinationBucket: this.webAssetsBucket,
          distribution: this.distribution,
          distributionPaths: ["/*"],
          // Keep hashed chunks reachable by tabs opened before this deployment.
          prune: false,
          retainOnDelete: true,
          ...(webAssetsDeploymentRole === undefined
            ? {}
            : { role: webAssetsDeploymentRole }),
          sources: [s3deployment.Source.asset(props.webAssetsPath)],
        },
      );
    }

    if (domain?.createDnsRecords === true) {
      if (
        domain.hostedZoneId === undefined ||
        domain.hostedZoneName === undefined
      ) {
        throw new TypeError(
          "Automatic DNS requires an exact hosted zone ID and name.",
        );
      }
      const zone = route53.HostedZone.fromHostedZoneAttributes(
        this,
        "HostedZone",
        {
          hostedZoneId: domain.hostedZoneId,
          zoneName: domain.hostedZoneName,
        },
      );
      const aliasTarget = route53.RecordTarget.fromAlias(
        new route53Targets.CloudFrontTarget(this.distribution),
      );
      new route53.ARecord(this, "AliasA", {
        recordName: domain.domainName,
        target: aliasTarget,
        zone,
      });
      new route53.AaaaRecord(this, "AliasAaaa", {
        recordName: domain.domainName,
        target: aliasTarget,
        zone,
      });
    }

    const applicationUrl =
      domain === undefined
        ? `https://${this.distribution.distributionDomainName}`
        : `https://${domain.domainName}`;
    const dnsRecordType =
      domain?.createDnsRecords === true ? "A and AAAA alias" : "CNAME";
    new CfnOutput(this, "DeploymentEnvironment", {
      description: "Exact Cloud Markup environment profile.",
      value: props.config.environment,
    });
    new CfnOutput(this, "AwsAccountId", {
      description: "Non-secret AWS account synthesis target.",
      value: this.account,
    });
    new CfnOutput(this, "AwsRegion", {
      description: "Non-secret AWS Region synthesis target.",
      value: this.region,
    });
    new CfnOutput(this, "ApplicationUrl", {
      description: "Public CloudFront application origin.",
      value: applicationUrl,
    });
    new CfnOutput(this, "ApiUrl", {
      description: "Public same-origin API base URL.",
      value: `${applicationUrl}/api`,
    });
    new CfnOutput(this, "PublicIngressType", {
      description: "The application uses CloudFront DNS, not a static IP.",
      value: "CloudFront",
    });
    new CfnOutput(this, "DnsRecordName", {
      description: "Public DNS record name.",
      value: domain?.domainName ?? this.distribution.distributionDomainName,
    });
    new CfnOutput(this, "DnsRecordType", {
      description: "Required DNS record form.",
      value: dnsRecordType,
    });
    new CfnOutput(this, "DnsTarget", {
      description: "CloudFront distribution DNS target.",
      value: this.distribution.distributionDomainName,
    });
    new CfnOutput(this, "DnsTargetHostedZoneId", {
      description: "Canonical Route 53 hosted-zone ID for CloudFront aliases.",
      value: "Z2FDTNDATAQYW2",
    });
    new CfnOutput(this, "DnsCreatedAutomatically", {
      description: "Whether this stack creates Route 53 A and AAAA aliases.",
      value: String(domain?.createDnsRecords === true),
    });
    if (domain !== undefined) {
      new CfnOutput(this, "CertificateArn", {
        description: "Pre-provisioned ACM certificate attached to CloudFront.",
        value: domain.certificateArn,
      });
    }
    new CfnOutput(this, "CloudFrontDistributionId", {
      description: "Distribution ID used for operational invalidations.",
      value: this.distribution.distributionId,
    });
    new CfnOutput(this, "CloudFrontDistributionDomainName", {
      description: "CloudFront distribution DNS name.",
      value: this.distribution.distributionDomainName,
    });
    new CfnOutput(this, "WebAssetsBucketName", {
      description: "Private bucket receiving the reviewed web build.",
      value: this.webAssetsBucket.bucketName,
    });
  }
}
