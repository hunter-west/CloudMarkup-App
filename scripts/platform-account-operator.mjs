import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function parseOperatorArguments(args) {
  const known = new Set([
    "--profile",
    "--email",
    "--action",
    "--reason",
    "--confirm-digest",
    "--permissions",
    "--pending-checkout-attempt",
    "--pending-checkout-session",
    "--pending-checkout-request",
  ]);
  const flags = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i],
      value = args[i + 1];
    if (
      !known.has(key) ||
      !value ||
      value.startsWith("--") ||
      flags[key] !== undefined
    )
      throw Error("Invalid operator arguments.");
    flags[key] = value;
  }
  if (
    !flags["--profile"] ||
    !flags["--email"] ||
    !flags["--reason"] ||
    !["staff-authorize", "staff-revoke", "live-cutover"].includes(
      flags["--action"],
    )
  )
    throw Error(
      "Specify --profile, --email, --reason and --action (staff-authorize, staff-revoke, live-cutover).",
    );
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(flags["--email"]) ||
    flags["--email"].length > 254 ||
    flags["--reason"].length < 5 ||
    flags["--reason"].length > 300 ||
    Array.from(flags["--reason"]).some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    throw Error("Invalid identity or reason.");
  if (
    flags["--confirm-digest"] &&
    !/^[a-f0-9]{64}$/u.test(flags["--confirm-digest"])
  )
    throw Error("Confirmation must be the exact preview digest.");
  const permissions = (
    flags["--permissions"] ??
    "accounts.read,credits.grant,credits.revoke,operations.manage"
  ).split(",");
  if (
    new Set(permissions).size !== permissions.length ||
    permissions.some(
      (p) =>
        ![
          "accounts.read",
          "credits.grant",
          "credits.revoke",
          "operations.manage",
          "trials.grant",
          "trials.revoke",
        ].includes(p),
    )
  )
    throw Error("Invalid staff permissions.");
  const pendingFlags = [
    "--pending-checkout-attempt",
    "--pending-checkout-session",
    "--pending-checkout-request",
  ];
  const provided = pendingFlags.filter((key) => flags[key] !== undefined);
  if (
    provided.length &&
    (provided.length !== 3 ||
      flags["--action"] !== "live-cutover" ||
      !/^checkout_[a-f0-9]{32}$/u.test(flags["--pending-checkout-attempt"]) ||
      !/^cs_test_[A-Za-z0-9_]{1,247}$/u.test(
        flags["--pending-checkout-session"],
      ) ||
      !/^req_[A-Za-z0-9_]{1,250}$/u.test(flags["--pending-checkout-request"]))
  )
    throw Error(
      "Pending Checkout reconciliation requires an exact test request/session attestation for live-cutover.",
    );
  return {
    pendingCheckout:
      provided.length === 0
        ? undefined
        : {
            attemptId: flags["--pending-checkout-attempt"],
            providerSessionReference: flags["--pending-checkout-session"],
            providerRequestId: flags["--pending-checkout-request"],
          },
    profile: flags["--profile"],
    email: flags["--email"],
    action: flags["--action"],
    reason: flags["--reason"],
    confirmation: flags["--confirm-digest"],
    permissions,
  };
}
async function main(args) {
  const input = parseOperatorArguments(args);
  // No shell interpretation; raw AWS configuration, credentials and provider user
  // data never appear in logs. Only the final minimized preview/receipt is printed.
  function aws(command) {
    return JSON.parse(
      execFileSync(
        "aws",
        [
          ...command,
          "--profile",
          input.profile,
          "--region",
          "us-east-1",
          "--output",
          "json",
          "--no-cli-pager",
        ],
        {
          encoding: "utf8",
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
          maxBuffer: 1024 * 1024,
        },
      ),
    );
  }
  const caller = aws(["sts", "get-caller-identity"]);
  if (caller.Account !== "000000000000" || typeof caller.Arn !== "string")
    throw Error("The reviewed beta AWS account is required.");
  const config = aws([
    "lambda",
    "get-function-configuration",
    "--function-name",
    "cloudmarkup-beta-api",
  ]);
  const env = config.Environment?.Variables;
  if (
    !env ||
    env.CLOUDMARKUP_ENVIRONMENT !== "beta" ||
    !env.COGNITO_USER_POOL_ID?.startsWith("us-east-1_") ||
    !env.CLOUDMARKUP_DATABASE_ARN?.startsWith(
      "arn:aws:rds:us-east-1:000000000000:cluster:",
    ) ||
    !env.CLOUDMARKUP_DATABASE_SECRET_ARN?.startsWith(
      "arn:aws:secretsmanager:us-east-1:000000000000:secret:",
    ) ||
    env.CLOUDMARKUP_DATABASE_NAME !== "cloudmarkup"
  )
    throw Error("The reviewed beta runtime configuration is required.");
  const user = aws([
    "cognito-idp",
    "admin-get-user",
    "--user-pool-id",
    env.COGNITO_USER_POOL_ID,
    "--username",
    input.email,
  ]);
  const attributes = Object.fromEntries(
    (user.UserAttributes ?? []).map((a) => [a.Name, a.Value]),
  );
  if (
    (input.action !== "staff-revoke" &&
      (user.Enabled !== true || user.UserStatus !== "CONFIRMED")) ||
    attributes.email_verified !== "true" ||
    attributes.email?.toLowerCase() !== input.email.toLowerCase() ||
    typeof attributes.sub !== "string"
  )
    throw Error(
      "An enabled, confirmed Cognito account with this verified email is required.",
    );
  const outfile = resolve(
    root,
    "apps/api/.cache/operator/platform-operator.mjs",
  );
  await mkdir(dirname(outfile), { recursive: true });
  await build({
    entryPoints: [
      resolve(root, "apps/api/src/adapters/persistence/platform-operator.ts"),
    ],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    packages: "external",
    logLevel: "silent",
  });
  process.env.AWS_PROFILE = input.profile;
  process.env.AWS_REGION = "us-east-1";
  const runtime = await import(pathToFileURL(outfile).href);
  const database = new runtime.RdsDataApiDatabase({
    database: env.CLOUDMARKUP_DATABASE_NAME,
    resourceArn: env.CLOUDMARKUP_DATABASE_ARN,
    secretArn: env.CLOUDMARKUP_DATABASE_SECRET_ARN,
  });
  try {
    const issuer =
      "https://cognito-idp.us-east-1.amazonaws.com/" + env.COGNITO_USER_POOL_ID;
    const result = await database.query({
      text: "SELECT p.principal_id FROM principal_identity_references i JOIN principals p ON p.principal_id=i.principal_id WHERE i.identity_provider='cognito' AND i.issuer=$1 AND i.subject_reference=$2 AND ($3='staff-revoke' OR p.lifecycle_status='active')",
      values: [issuer, attributes.sub, input.action],
    });
    if (
      result.rows.length !== 1 ||
      typeof result.rows[0].principal_id !== "string"
    )
      throw Error(
        "Sign in to Cloud Markup first so its immutable principal mapping exists.",
      );
    const principalId = result.rows[0].principal_id;
    let output;
    if (input.action === "live-cutover") {
      const terminalCheckouts = await runtime.inspectTerminalTestCheckouts(
        database,
        principalId,
        () => {
          const secret = aws([
            "secretsmanager",
            "get-secret-value",
            "--secret-id",
            "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/stripe/api-key-EX0004",
          ]);
          if (typeof secret.SecretString !== "string")
            throw Error("The retained test API key is unavailable.");
          return Promise.resolve(
            new runtime.StripeBillingProvider({
              apiKey: runtime.decodeStripeSandboxApiKey(
                new TextEncoder().encode(secret.SecretString),
              ),
              stripeEnvironment: "test",
              verificationMode: "hosted-sessions-only",
              signatureToleranceSeconds: 300,
            }),
          );
        },
        input.pendingCheckout === undefined
          ? []
          : [
              {
                ...input.pendingCheckout,
                operatorReference: caller.Arn,
                reason: input.reason,
              },
            ],
      );
      output = input.confirmation
        ? await runtime.applyLiveBillingCutover(
            database,
            principalId,
            input.confirmation,
            terminalCheckouts,
          )
        : await database.transaction((tx) =>
            runtime.prepareLiveBillingCutover(
              tx,
              principalId,
              terminalCheckouts,
            ),
          );
    } else {
      const request = {
        issuer,
        subject: attributes.sub,
        principalId,
        operatorReference: caller.Arn,
        reason: input.reason,
        permissions: input.permissions,
        action: input.action === "staff-authorize" ? "authorized" : "revoked",
      };
      output = input.confirmation
        ? await runtime.applyStaffAuthorization(
            database,
            request,
            input.confirmation,
          )
        : await database.transaction((tx) =>
            runtime.prepareStaffAuthorization(tx, request),
          );
    }
    process.stdout.write(
      JSON.stringify(
        { mode: input.confirmation ? "applied" : "preview", ...output },
        null,
        2,
      ) + "\n",
    );
  } finally {
    await database.close();
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main(process.argv.slice(2)).catch(() => {
    process.stderr.write(
      "Operator command did not complete. Check the reviewed account, identity, migration, quiet cutover prerequisites and exact preview digest. No raw provider/database error is logged.\n",
    );
    process.exitCode = 1;
  });
