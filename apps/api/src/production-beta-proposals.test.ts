import { describe, expect, it } from "vitest";
import { betaProposalQueueTarget } from "./production-beta-proposals.js";
const queueArn =
  "arn:aws:sqs:us-east-1:000000000000:cloudmarkup-beta-proposals.fifo";
const queueUrl =
  "https://sqs.us-east-1.amazonaws.com/000000000000/cloudmarkup-beta-proposals.fifo";
const enabled = {
  AWS_REGION: "us-east-1",
  CLOUDMARKUP_ENVIRONMENT: "beta",
  CLOUDMARKUP_BETA_AI_ENABLED: "true",
  CLOUDMARKUP_BETA_PROPOSAL_QUEUE_ARN: queueArn,
};
describe("beta proposal queue configuration", () => {
  it("derives the exact queue URL from one validated ARN", () => {
    expect(betaProposalQueueTarget(enabled)).toEqual({
      queueArn,
      queueUrl,
      region: "us-east-1",
    });
    expect(
      betaProposalQueueTarget({
        ...enabled,
        CLOUDMARKUP_BETA_PROPOSAL_QUEUE_URL: queueUrl,
      }),
    ).toEqual({ queueArn, queueUrl, region: "us-east-1" });
    expect(betaProposalQueueTarget({})).toBeUndefined();
  });
  it.each([
    { CLOUDMARKUP_ENVIRONMENT: "production" },
    { CLOUDMARKUP_BETA_AI_ENABLED: "false" },
    { AWS_REGION: "us-west-2" },
    {
      CLOUDMARKUP_BETA_PROPOSAL_QUEUE_ARN: queueArn.replace(
        "000000000000",
        "111111111111",
      ),
    },
    {
      CLOUDMARKUP_BETA_PROPOSAL_QUEUE_ARN: queueArn.replace(
        "proposals.fifo",
        "unreviewed.fifo",
      ),
    },
    {
      CLOUDMARKUP_BETA_PROPOSAL_QUEUE_ARN: undefined,
      CLOUDMARKUP_BETA_PROPOSAL_QUEUE_URL: queueUrl,
    },
    { CLOUDMARKUP_BETA_PROPOSAL_QUEUE_URL: queueUrl + "-unreviewed" },
  ])("rejects a mismatched or incomplete binding %j", (change) => {
    expect(() => betaProposalQueueTarget({ ...enabled, ...change })).toThrow(
      "Background proposal configuration is unavailable.",
    );
  });
});
