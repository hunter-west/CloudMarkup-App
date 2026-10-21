/** Synthetic public catalog references. Private operations owns the reviewed
 * live catalog; secret values are resolved only at runtime. */
export const REVIEWED_LIVE_STRIPE = Object.freeze({
  apiKeyArn:
    "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/stripe/live/api-key-EX0003",
  webhookSigningSecretArn:
    "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/stripe/live/webhook-signing-secret-EX0005",
  portalConfigurationReference: "bpc_ExampleLive",
  starter: Object.freeze({
    productReference: "prod_ExampleStarterLive",
    priceReference: "price_ExampleStarterLive",
  }),
  pro: Object.freeze({
    productReference: "prod_ExampleProLive",
    priceReference: "price_ExampleProLive",
  }),
  topUps: Object.freeze({
    small: Object.freeze({
      productReference: "prod_ExampleSmallTopUp",
      priceReference: "price_ExampleSmallTopUp",
    }),
    medium: Object.freeze({
      productReference: "prod_ExampleMediumTopUp",
      priceReference: "price_ExampleMediumTopUp",
    }),
    large: Object.freeze({
      productReference: "prod_ExampleLargeTopUp",
      priceReference: "price_ExampleLargeTopUp",
    }),
  }),
});
