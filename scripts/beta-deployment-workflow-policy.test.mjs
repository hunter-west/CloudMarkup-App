import "./classify-beta-deployment.test.mjs";
import "./ci-historical-preparation.test.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parse, stringify } from "yaml";

import {
  BETA_DEPLOYMENT_WORKFLOW_PATH,
  assertHistoricalAiReceiptPreparation,
  validateBetaDeploymentWorkflowText,
} from "./beta-deployment-workflow-policy.mjs";
import { serializeBetaServiceProfile } from "./beta-sandbox-delivery-admission.mjs";

const workflow = readFileSync(BETA_DEPLOYMENT_WORKFLOW_PATH, "utf8");
const codes = (text) =>
  validateBetaDeploymentWorkflowText(text).map(({ code }) => code);
const serviceSelectors = [
  "BETA_SERVICE_PROFILE",
  "BETA_STRIPE_SANDBOX_SESSIONS_ENABLED",
  "BETA_STRIPE_WEBHOOK_SIGNING_SECRET_ARN",
  "BETA_STRIPE_PREVIOUS_WEBHOOK_SIGNING_SECRET_ARN",
];

function mutatePrepareSteps(mutator) {
  const document = parse(workflow);
  const steps = document.jobs.prepare.steps;
  mutator(steps);
  return stringify(document);
}

function mutateDeploymentArtifactSteps(mutator) {
  const document = parse(workflow);
  const upload = document.jobs.prepare.steps.find((step) =>
    String(step.uses ?? "").startsWith("actions/upload-artifact@"),
  );
  const download = document.jobs.deploy.steps.find((step) =>
    String(step.uses ?? "").startsWith("actions/download-artifact@"),
  );
  assert.ok(upload, "deployment upload");
  assert.ok(download, "deployment download");
  mutator({ download, upload });
  return stringify(document);
}

function prepareStepIndex(steps, name) {
  const index = steps.findIndex((step) => step.name === name);
  assert.notEqual(index, -1, name);
  return index;
}

function swapPrepareSteps(leftName, rightName) {
  return mutatePrepareSteps((steps) => {
    const leftIndex = prepareStepIndex(steps, leftName);
    const rightIndex = prepareStepIndex(steps, rightName);
    [steps[leftIndex], steps[rightIndex]] = [
      steps[rightIndex],
      steps[leftIndex],
    ];
  });
}

test("accepts the reviewed simplified beta delivery workflow", () => {
  assert.deepEqual(validateBetaDeploymentWorkflowText(workflow), []);
});

test("binds every service selector to protected variables in only reviewed steps", () => {
  const mutations = [
    [
      "missing prepare mapping",
      ({ prepare }, key) => {
        Reflect.deleteProperty(
          prepare.steps.find(({ run }) => run === "pnpm beta:synth").env,
          key,
        );
      },
    ],
    [
      "prepare literal",
      ({ prepare }, key) => {
        prepare.steps.find(
          ({ run }) => run === "pnpm beta:release-gate:policy",
        ).env[key] = "core-v1";
      },
    ],
    [
      "prepare secret",
      ({ prepare }, key) => {
        prepare.steps.find(
          ({ run }) => run === "pnpm beta:release-gate:artifacts",
        ).env[key] = `\${{ secrets.${key} }}`;
      },
    ],
    [
      "assembly missing",
      ({ prepare }, key) => {
        Reflect.deleteProperty(
          prepare.steps.find(
            ({ name }) => name === "Assemble the same-run deployment bundle",
          ).env,
          key,
        );
      },
    ],
    [
      "job prepare leak",
      ({ prepare }, key) => {
        prepare.env[key] = `\${{ vars.${key} }}`;
      },
    ],
    [
      "ordinary build leak",
      ({ prepare }, key) => {
        prepare.steps.find(({ run }) => run === "pnpm build").env = {
          [key]: `\${{ vars.${key} }}`,
        };
      },
    ],
    [
      "deploy missing",
      ({ deploy }, key) => {
        Reflect.deleteProperty(deploy.env, key);
      },
    ],
    [
      "deploy unprotected input",
      ({ deploy }, key) => {
        deploy.env[key] = `\${{ inputs.${key} }}`;
      },
    ],
    [
      "deploy step override",
      ({ deploy }, key) => {
        deploy.steps.find(
          ({ name }) => name === "Admit the exact commit-bound bundle",
        ).env = { [key]: `\${{ vars.${key} }}` };
      },
    ],
    [
      "shell override",
      ({ prepare }, key) => {
        prepare.steps.find(
          ({ name }) => name === "Assemble the same-run deployment bundle",
        ).run += `\nexport ${key}=core-v1\n`;
      },
    ],
  ];
  for (const key of serviceSelectors) {
    for (const [label, mutate] of mutations) {
      const document = parse(workflow);
      mutate(document.jobs, key);
      assert.ok(
        codes(stringify(document)).includes(
          "BETA_WORKFLOW_SERVICE_PROFILE_SCOPE_INVALID",
        ),
        `${key}: ${label}`,
      );
    }
    const document = parse(workflow);
    document.env = { [key]: `\${{ vars.${key} }}` };
    assert.ok(
      codes(stringify(document)).includes(
        "BETA_WORKFLOW_SERVICE_PROFILE_SCOPE_INVALID",
      ),
      `${key}: global override`,
    );
  }
});

test("requires copied-assembly admission before receipt hashing and the fail-closed privileged check", () => {
  const mutations = [
    [
      "missing helper",
      ({ assembly }) => {
        assembly.run = assembly.run
          .split("\n")
          .filter(
            (line) =>
              !line
                .trim()
                .startsWith(
                  'cp "$GITHUB_WORKSPACE/scripts/beta-sandbox-delivery-admission.mjs"',
                ),
          )
          .join("\n");
      },
    ],
    ...["missing", "duplicated", "after binding"].map((kind) => [
      kind + " export admission helper",
      ({ assembly }) => {
        const copy =
          'cp "$GITHUB_WORKSPACE/scripts/beta-solution-export-admission.mjs" "$bundle/runtime/beta-solution-export-admission.mjs"';
        const lines = assembly.run.split("\n");
        const index = lines.findIndex((line) => line.trim() === copy);
        assert.ok(index >= 0);
        const [line] = lines.splice(index, 1);
        if (kind === "duplicated") lines.splice(index, 0, line, line);
        if (kind === "after binding") lines.push(line);
        assembly.run = lines.join("\n");
      },
    ]),
    ...["missing", "duplicated", "after binding"].map((kind) => [
      kind + " proposal admission helper",
      ({ assembly }) => {
        const copy =
          'cp "$GITHUB_WORKSPACE/scripts/beta-proposal-admission.mjs" "$bundle/runtime/beta-proposal-admission.mjs"';
        const lines = assembly.run.split("\n");
        const index = lines.findIndex((line) => line.trim() === copy);
        assert.ok(index >= 0);
        const [line] = lines.splice(index, 1);
        if (kind === "duplicated") lines.splice(index, 0, line, line);
        if (kind === "after binding") lines.push(line);
        assembly.run = lines.join("\n");
      },
    ]),
    [
      "missing copied-assembly binder",
      ({ assembly }) => {
        assembly.run = assembly.run
          .split("\n")
          .filter((line) => !line.includes("--bind-service-profile"))
          .join("\n");
      },
    ],
    [
      "receipt after checksum",
      ({ assembly }) => {
        const lines = assembly.run.split("\n");
        const [receipt] = lines.splice(
          lines.findIndex((line) => line.includes("--bind-service-profile")),
          1,
        );
        lines.splice(
          lines.findIndex((line) => line.includes("sha256sum --check")) + 1,
          0,
          receipt,
        );
        assembly.run = lines.join("\n");
      },
    ],
    [
      "standalone serialization instead of copied-assembly admission",
      ({ assembly }) => {
        assembly.run = assembly.run.replace(
          "node scripts/verify-beta-release.mjs --bind-service-profile",
          `node --input-type=module -e 'import{writeFileSync}from"node:fs";import{serializeBetaServiceProfile}from"./scripts/beta-sandbox-delivery-admission.mjs";writeFileSync("SERVICE_PROFILE.json",serializeBetaServiceProfile(process.env));'`,
        );
      },
    ],
    [
      "binder before assembly copy",
      ({ assembly }) => {
        const lines = assembly.run.split("\n");
        const copyIndex = lines.findIndex((line) =>
          line.includes('cp -R "$GITHUB_WORKSPACE/artifacts/platform/cdk.out"'),
        );
        const [copy] = lines.splice(copyIndex, 1);
        lines.splice(
          lines.findIndex((line) => line.includes("--bind-service-profile")) +
            1,
          0,
          copy,
        );
        assembly.run = lines.join("\n");
      },
    ],
    [
      "binder failure ignored",
      ({ assembly }) => {
        assembly.run = assembly.run.replace(
          "node scripts/verify-beta-release.mjs --bind-service-profile",
          "node scripts/verify-beta-release.mjs --bind-service-profile || true",
        );
      },
    ],
    [
      "wrong copied assembly",
      ({ assembly }) => {
        assembly.run = assembly.run.replace(
          '"$GITHUB_WORKSPACE/artifacts/platform/cdk.out"',
          '"$GITHUB_WORKSPACE/artifacts/platform/unadmitted-cdk.out"',
        );
      },
    ],
    [
      "binder outside repository root",
      ({ assembly }) => {
        assembly["working-directory"] = "artifacts/platform/deployment-bundle";
      },
    ],
    [
      "shell changes directory before binder",
      ({ assembly }) => {
        assembly.run = assembly.run.replace(
          "node scripts/verify-beta-release.mjs --bind-service-profile",
          'cd "$bundle"\nnode scripts/verify-beta-release.mjs --bind-service-profile',
        );
      },
    ],
    [
      "receipt excluded from hashes",
      ({ assembly }) => {
        assembly.run = assembly.run.replace(
          "! -name SHA256SUMS",
          "! -name SHA256SUMS ! -name SERVICE_PROFILE.json",
        );
      },
    ],
    [
      "missing privileged receipt check",
      ({ admission }) => {
        admission.run = admission.run
          .split("\n")
          .filter((line) => !line.includes("assertBetaServiceProfileReceipt"))
          .join("\n");
      },
    ],
    [
      "receipt check ignores failure",
      ({ admission }) => {
        admission.run = admission.run.replace(
          "process.env);'",
          "process.env);' || true",
        );
      },
    ],
    [
      "skip admission",
      ({ admission }) => {
        admission.if = false;
      },
    ],
    [
      "continue admission failure",
      ({ admission }) => {
        admission["continue-on-error"] = true;
      },
    ],
    [
      "before digest",
      ({ admission }) => {
        const lines = admission.run.split("\n");
        const [receipt] = lines.splice(
          lines.findIndex((line) =>
            line.includes("assertBetaServiceProfileReceipt"),
          ),
          1,
        );
        lines.splice(
          lines.findIndex((line) => line.includes("sha256sum --check")),
          0,
          receipt,
        );
        admission.run = lines.join("\n");
      },
    ],
    [
      "after CDK",
      ({ deploy, admission }) => {
        deploy.steps.splice(deploy.steps.indexOf(admission), 1);
        const cdkIndex = deploy.steps.findIndex(({ run }) =>
          String(run).includes('runtime/aws-cdk/bin/cdk" deploy'),
        );
        deploy.steps.splice(cdkIndex + 1, 0, admission);
      },
    ],
  ];
  for (const [label, mutate] of mutations) {
    const document = parse(workflow);
    const { prepare, deploy } = document.jobs;
    const assembly = prepare.steps.find(
      ({ name }) => name === "Assemble the same-run deployment bundle",
    );
    const admission = deploy.steps.find(
      ({ name }) => name === "Admit the exact commit-bound bundle",
    );
    mutate({ assembly, admission, deploy });
    assert.ok(
      codes(stringify(document)).includes(
        "BETA_WORKFLOW_SERVICE_PROFILE_BINDING_INVALID",
      ),
      label,
    );
  }
});

test("executes the privileged receipt check without checkout dependencies and rejects changed deployment inputs", () => {
  const document = parse(workflow);
  const admission = document.jobs.deploy.steps.find(
    ({ name }) => name === "Admit the exact commit-bound bundle",
  );
  const nodeSource = (step, marker) => {
    const line = step.run.split("\n").find((value) => value.includes(marker));
    const match = line?.trim().match(/^node --input-type=module -e '(.*)'$/u);
    assert.ok(match);
    return match[1];
  };
  const checkReceipt = nodeSource(
    admission,
    "assertBetaServiceProfileReceipt(",
  );
  for (const profile of [
    "core-v1",
    "stripe-sandbox-v1",
    "stripe-sandbox-github-connections-v1",
    "stripe-sandbox-github-cloudformation-v1",
  ]) {
    const fixture = mkdtempSync(join(tmpdir(), "cloudmarkup-profile-receipt-"));
    try {
      mkdirSync(join(fixture, "runtime"));
      for (const helper of [
        "beta-sandbox-delivery-admission.mjs",
        "beta-solution-export-admission.mjs",
        "beta-proposal-admission.mjs",
        "beta-release-gate-core.mjs",
      ]) {
        copyFileSync(join("scripts", helper), join(fixture, "runtime", helper));
      }
      const environment = { ...process.env };
      for (const key of serviceSelectors) {
        environment[key] = "";
      }
      environment.BETA_SERVICE_PROFILE = profile;
      if (profile !== "core-v1") {
        environment.BETA_STRIPE_WEBHOOK_SIGNING_SECRET_ARN =
          "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/stripe/webhook-signing-secret-AbC123";
      }
      const run = (source, env = environment) =>
        execFileSync(process.execPath, ["--input-type=module", "-e", source], {
          cwd: fixture,
          env,
          stdio: "pipe",
        });
      // Synthetic canonical receipt fixture only. The real copied-assembly
      // binder and its exclusive write are covered by verify-beta-release tests.
      writeFileSync(
        join(fixture, "SERVICE_PROFILE.json"),
        serializeBetaServiceProfile(environment),
        { encoding: "utf8", flag: "wx" },
      );
      run(checkReceipt);
      run(
        'import{validateBetaReleaseEnvironment}from"./runtime/beta-release-gate-core.mjs";if(!Array.isArray(validateBetaReleaseEnvironment({})))throw new Error("Invalid isolated verifier");',
      );
      assert.throws(() =>
        run(checkReceipt, {
          ...environment,
          BETA_SERVICE_PROFILE:
            profile === "core-v1" ? "stripe-sandbox-v1" : "core-v1",
        }),
      );
      if (profile !== "core-v1") {
        assert.throws(() =>
          run(checkReceipt, {
            ...environment,
            BETA_SERVICE_PROFILE:
              profile === "stripe-sandbox-v1"
                ? "stripe-sandbox-github-connections-v1"
                : "stripe-sandbox-v1",
          }),
        );
        assert.throws(() =>
          run(checkReceipt, {
            ...environment,
            BETA_STRIPE_WEBHOOK_SIGNING_SECRET_ARN:
              environment.BETA_STRIPE_WEBHOOK_SIGNING_SECRET_ARN.replace(
                "AbC123",
                "DeF456",
              ),
          }),
        );
        assert.throws(() =>
          run(checkReceipt, {
            ...environment,
            BETA_STRIPE_SANDBOX_SESSIONS_ENABLED: "true",
          }),
        );
      }
      const receipt = join(fixture, "SERVICE_PROFILE.json");
      writeFileSync(
        receipt,
        JSON.stringify({
          ...JSON.parse(readFileSync(receipt, "utf8")),
          extra: true,
        }) + "\n",
      );
      assert.throws(() => run(checkReceipt));
      rmSync(receipt);
      assert.throws(() => run(checkReceipt));
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }
});

test("requires successful exact-commit verification before privileged deployment", () => {
  for (const mutate of [
    (d) => {
      d.jobs.deploy.needs = ["prepare"];
    },
    (d) => {
      d.jobs.deploy.if = "always()";
    },
    (d) => {
      d.jobs.deploy["continue-on-error"] = true;
    },
  ]) {
    const d = parse(workflow);
    mutate(d);
    assert.ok(
      codes(stringify(d)).includes("BETA_WORKFLOW_DEPLOY_BOUNDARY_INVALID"),
    );
  }
  for (const mutate of [
    (d) => {
      d.jobs.verify.uses = "owner/repo/.github/workflows/ci.yml@main";
    },
    (d) => {
      d.jobs.verify.if = "false";
    },
    (d) => {
      d.jobs.verify.secrets = "inherit";
    },
    (d) => {
      d.jobs.verify.permissions["id-token"] = "write";
    },
    (d) => {
      delete d.jobs.verify.with;
    },
    (d) => {
      d.jobs.verify.with.functional_beta = false;
    },
    (d) => {
      d.jobs.verify.with.skip_security = true;
    },
    (d) => {
      delete d.jobs.verify;
    },
  ]) {
    const d = parse(workflow);
    mutate(d);
    assert.ok(codes(stringify(d)).includes("BETA_WORKFLOW_VERIFY_INVALID"));
  }
});

test("keeps test database configuration in credentialless CI", () => {
  for (const mutate of [
    (d) => {
      d.jobs.prepare.services = { postgres: {} };
    },
    (d) => {
      d.jobs.deploy.services = { postgres: {} };
    },
    (d) => {
      d.jobs.prepare.env.CLOUDMARKUP_TEST_DATABASE_URL = "external";
    },
    (d) => {
      d.jobs.deploy.env.CLOUDMARKUP_TEST_DATABASE_URL = "external";
    },
    (d) => {
      d.jobs.prepare["continue-on-error"] = true;
    },
    (d) => {
      d.jobs.prepare.container = "unreviewed";
    },
  ]) {
    const d = parse(workflow);
    mutate(d);
    assert.ok(
      codes(stringify(d)).includes("BETA_WORKFLOW_PREPARE_DATABASE_INVALID"),
    );
  }
});

test("rejects literal patch artifacts in multiline shell commands", () => {
  const malformed = workflow.replace(
    'node "$bundle/runtime/aws-cdk/bin/cdk" deploy \\',
    'node "$bundle/runtime/aws-cdk/bin/cdk" deploy +            --app malformed',
  );
  assert.notEqual(malformed, workflow);
  assert.ok(codes(malformed).includes("BETA_WORKFLOW_PATCH_ARTIFACT"));
});

test("rejects trigger, repository, and OIDC permission drift", () => {
  assert.ok(
    codes(workflow.replace("branches: [main]", "branches: [feature]")).includes(
      "BETA_WORKFLOW_TRIGGER_INVALID",
    ),
  );
  assert.ok(
    codes(
      workflow.replaceAll("hunter-west/CloudMarkup", "other/repository"),
    ).includes("BETA_WORKFLOW_PREPARE_BOUNDARY_INVALID"),
  );
  assert.ok(
    codes(workflow.replace("id-token: write", "id-token: read")).includes(
      "BETA_WORKFLOW_DEPLOY_BOUNDARY_INVALID",
    ),
  );
});

test("rejects obsolete manual digest, image, and activation inputs", () => {
  for (const input of [
    "APPLICATION_BUILD_IMAGE_DIGEST",
    "TERRAFORM_VALIDATION_IMAGE_DIGEST",
    "DEPLOYMENT_ASSEMBLY_SHA256",
    "DEPLOYMENT_RUNTIME_SHA256",
    "CLOUDMARKUP_DEPLOYMENT_ENABLED",
  ]) {
    assert.ok(
      codes(`${workflow}\nenv:\n  ${input}: manual\n`).includes(
        "BETA_WORKFLOW_OBSOLETE_INPUT",
      ),
    );
  }
});

test("rejects unpinned actions and static credentials", () => {
  const unpinnedPreflight = parse(workflow);
  unpinnedPreflight.jobs.changes.steps[0].uses = "actions/checkout@v6";
  assert.ok(
    codes(stringify(unpinnedPreflight)).includes(
      "BETA_WORKFLOW_CHANGES_INVALID",
    ),
  );
  const unpinnedPrepare = parse(workflow);
  unpinnedPrepare.jobs.prepare.steps.find((step) =>
    String(step.uses ?? "").startsWith("actions/checkout@"),
  ).uses = "actions/checkout@v6";
  assert.ok(
    codes(stringify(unpinnedPrepare)).includes(
      "BETA_WORKFLOW_ACTION_NOT_PINNED",
    ),
  );
  assert.ok(
    codes(`${workflow}\nenv:\n  aws-access-key-id: unsafe\n`).includes(
      "BETA_WORKFLOW_STATIC_CREDENTIAL",
    ),
  );
});

test("keeps AWS credentials out of preparation", () => {
  const credentialed = mutatePrepareSteps((steps) => {
    const policyIndex = prepareStepIndex(
      steps,
      "Verify reviewed beta policy inputs",
    );
    steps.splice(policyIndex, 0, {
      name: "Acquire credentials before admission",
      uses: "aws-actions/configure-aws-credentials@e6de054238d6b7531b4efff3b6587d9aade6a06c",
    });
  });
  assert.ok(
    codes(credentialed).includes("BETA_WORKFLOW_PREPARE_BOUNDARY_INVALID"),
  );

  const staticSecrets = mutatePrepareSteps((steps) => {
    const policyIndex = prepareStepIndex(
      steps,
      "Verify reviewed beta policy inputs",
    );
    steps.splice(policyIndex, 0, {
      name: "Use renamed static credentials",
      env: {
        AWS_ACCESS_KEY_ID: "${{ secrets.CLOUD_ACCESS }}",
        AWS_SECRET_ACCESS_KEY: "${{ secrets.CLOUD_SECRET }}",
      },
      run: "aws sts get-caller-identity",
    });
  });
  assert.ok(
    codes(staticSecrets).includes("BETA_WORKFLOW_PREPARE_BOUNDARY_INVALID"),
  );
});

test("enforces one authoritative build and admission before bundle publication", () => {
  const orderedNames = [
    "Verify reviewed beta policy inputs",
    "Build and pin the real compiler for integration tests",
    "Build application and platform assets",
    "Synthesize credentialless beta CloudFormation",
    "Verify built application and synthesized CloudFormation",
    "Assemble the same-run deployment bundle",
    "Upload the exact same-run deployment bundle",
  ];
  for (let index = 1; index < orderedNames.length; index += 1) {
    const leftName = orderedNames[index - 1];
    const rightName = orderedNames[index];
    assert.ok(
      codes(swapPrepareSteps(leftName, rightName)).includes(
        "BETA_WORKFLOW_PREPARE_ORDER_INVALID",
      ),
      `${leftName} must precede ${rightName}`,
    );
  }

  const missingFinalAdmission = mutatePrepareSteps((steps) => {
    steps[
      prepareStepIndex(
        steps,
        "Verify built application and synthesized CloudFormation",
      )
    ].run = "true";
  });
  assert.ok(
    codes(missingFinalAdmission).includes(
      "BETA_WORKFLOW_PREPARE_ORDER_INVALID",
    ),
  );

  const bypassedUpload = mutatePrepareSteps((steps) => {
    steps[
      prepareStepIndex(steps, "Upload the exact same-run deployment bundle")
    ].if = "always()";
  });
  assert.ok(
    codes(bypassedUpload).includes("BETA_WORKFLOW_PREPARE_ORDER_INVALID"),
  );

  const interposedMutation = mutatePrepareSteps((steps) => {
    const assemblyIndex = prepareStepIndex(
      steps,
      "Assemble the same-run deployment bundle",
    );
    steps.splice(assemblyIndex, 0, {
      name: "Invalidate admitted artifacts",
      run: "rm -rf artifacts/platform/cdk.out",
    });
  });
  assert.ok(
    codes(interposedMutation).includes("BETA_WORKFLOW_PREPARE_ORDER_INVALID"),
  );
});

test("rejects missing commit and same-run artifact-digest bindings", () => {
  assert.ok(
    codes(
      workflow.replace(
        'printf \'%s\\n\' "$GITHUB_SHA" > "$bundle/SOURCE_REVISION"',
        "printf '%s\\n' unbound > \"$bundle/SOURCE_REVISION\"",
      ),
    ).includes("BETA_WORKFLOW_PREPARE_GATE_MISSING"),
  );
  assert.ok(
    codes(
      workflow.replace(
        "deployment-bundle-sha256: ${{ steps.upload.outputs.artifact-digest }}",
        "deployment-bundle-sha256: producer-value",
      ),
    ).includes("BETA_WORKFLOW_BUNDLE_BINDING_INVALID"),
  );
  assert.ok(
    codes(workflow.replace("sha256sum --check SHA256SUMS", "true")).includes(
      "BETA_WORKFLOW_PREPARE_GATE_MISSING",
    ),
  );
  assert.ok(
    codes(
      workflow.replace(
        'cp "$GITHUB_WORKSPACE/apps/web/src/assets/brand/public/$asset" "$bundle/reviewed-public-assets/$asset"',
        'cp "$GITHUB_WORKSPACE/apps/web/src/assets/brand/public/$asset" "$bundle/unreviewed-public-assets/$asset"',
      ),
    ).includes("BETA_WORKFLOW_PREPARE_GATE_MISSING"),
  );
  assert.ok(
    codes(
      workflow.replace(
        "include-hidden-files: true",
        "include-hidden-files: false",
      ),
    ).includes("BETA_WORKFLOW_BUNDLE_UPLOAD_INCOMPLETE"),
  );
});

test("rejects retry-unsafe deployment artifact bindings", () => {
  const attemptBoundUpload = mutateDeploymentArtifactSteps(({ upload }) => {
    upload.with.name =
      "cloudmarkup-beta-deployment-${{ github.sha }}-${{ github.run_attempt }}";
  });
  assert.ok(
    codes(attemptBoundUpload).includes("BETA_WORKFLOW_BUNDLE_BINDING_INVALID"),
  );

  const unboundUploadOutput = mutateDeploymentArtifactSteps(({ upload }) => {
    upload.id = "deployment-upload";
  });
  assert.ok(
    codes(unboundUploadOutput).includes("BETA_WORKFLOW_BUNDLE_BINDING_INVALID"),
  );

  const nonOverwritingUpload = mutateDeploymentArtifactSteps(({ upload }) => {
    upload.with.overwrite = false;
  });
  assert.ok(
    codes(nonOverwritingUpload).includes(
      "BETA_WORKFLOW_BUNDLE_UPLOAD_INCOMPLETE",
    ),
  );

  const attemptBoundDownload = mutateDeploymentArtifactSteps(({ download }) => {
    download.with.name =
      "cloudmarkup-beta-deployment-${{ github.sha }}-${{ github.run_attempt }}";
  });
  assert.ok(
    codes(attemptBoundDownload).includes(
      "BETA_WORKFLOW_BUNDLE_BINDING_INVALID",
    ),
  );

  for (const [input, value] of Object.entries({
    "github-token": "${{ github.token }}",
    repository: "other/repository",
    "run-id": "1234",
  })) {
    const crossRunDownload = mutateDeploymentArtifactSteps(({ download }) => {
      download.with[input] = value;
    });
    assert.ok(
      codes(crossRunDownload).includes("BETA_WORKFLOW_BUNDLE_BINDING_INVALID"),
      `${input} must not broaden the deployment artifact download scope`,
    );
  }
});

test("requires the tracked compiler Go version authority", () => {
  assert.ok(
    codes(
      workflow.replace(
        "go-version-file: services/iac-compiler/go.mod",
        "go-version-file: go.work",
      ),
    ).includes("BETA_WORKFLOW_GO_SETUP_INVALID"),
  );
  assert.ok(
    codes(
      workflow.replace(
        "cache-dependency-path: services/iac-compiler/go.sum",
        "cache-dependency-path: go.sum",
      ),
    ).includes("BETA_WORKFLOW_GO_SETUP_INVALID"),
  );
});

test("shares the checked Go cache authority between CI and deployment preparation", () => {
  const ci = parse(readFileSync(".github/workflows/ci.yml", "utf8"));
  const deployment = parse(workflow);
  const ciGo = ci.jobs.quality.steps.filter((step) =>
    String(step.uses ?? "").startsWith("actions/setup-go@"),
  );
  const prepareGo = deployment.jobs.prepare.steps.filter((step) =>
    String(step.uses ?? "").startsWith("actions/setup-go@"),
  );
  assert.equal(ciGo.length, 1);
  assert.equal(prepareGo.length, 1);
  assert.deepEqual(ciGo[0].with, {
    "go-version-file": "services/iac-compiler/go.mod",
    cache: true,
    "cache-dependency-path": "services/iac-compiler/go.sum",
  });
  assert.deepEqual(ciGo[0].with, prepareGo[0].with);
  assert.equal(ciGo[0].uses, prepareGo[0].uses);
  assert.equal(ci.jobs.quality["runs-on"], deployment.jobs.prepare["runs-on"]);
});

test("keeps the beta runtime selector out of ordinary product tests", () => {
  const jobEnvironmentMarker =
    "      BETA_CREATE_DNS_RECORDS: ${{ vars.BETA_CREATE_DNS_RECORDS }}\n";
  const leaked = workflow.replace(
    jobEnvironmentMarker,
    `${jobEnvironmentMarker}      CLOUDMARKUP_ENVIRONMENT: \${{ vars.CLOUDMARKUP_ENVIRONMENT }}\n`,
  );
  assert.notEqual(leaked, workflow);
  assert.ok(codes(leaked).includes("BETA_WORKFLOW_ENVIRONMENT_SCOPE_INVALID"));

  const missingFromSynth = mutatePrepareSteps((steps) => {
    delete steps.find(
      ({ name }) => name === "Synthesize credentialless beta CloudFormation",
    ).env.CLOUDMARKUP_ENVIRONMENT;
  });
  assert.notEqual(missingFromSynth, workflow);
  assert.ok(
    codes(missingFromSynth).includes("BETA_WORKFLOW_ENVIRONMENT_SCOPE_INVALID"),
  );
  const missingFromBinding = mutatePrepareSteps((steps) => {
    delete steps.find(
      ({ name }) => name === "Assemble the same-run deployment bundle",
    ).env.CLOUDMARKUP_ENVIRONMENT;
  });
  assert.ok(
    codes(missingFromBinding).includes(
      "BETA_WORKFLOW_ENVIRONMENT_SCOPE_INVALID",
    ),
  );
});

test("rejects application and DNS role drift", () => {
  assert.ok(
    codes(
      workflow.replace(
        "role-duration-seconds: 3600",
        "role-duration-seconds: 7200",
      ),
    ).includes("BETA_WORKFLOW_APPLICATION_OIDC_INVALID"),
  );
  assert.ok(
    codes(
      workflow.replace(
        "role-to-assume: arn:aws:iam::000000000000:role/CloudMarkup-Beta-GitHub",
        "role-to-assume: arn:aws:iam::000000000000:role/Other",
      ),
    ).includes("BETA_WORKFLOW_APPLICATION_OIDC_INVALID"),
  );
  assert.ok(
    codes(
      workflow.replace(
        "role-to-assume: arn:aws:iam::000000000001:role/CloudMarkup-Beta-DNS",
        "role-to-assume: arn:aws:iam::000000000001:role/Other",
      ),
    ).includes("BETA_WORKFLOW_DNS_ROLE_INVALID"),
  );
  assert.ok(
    codes(
      workflow.replace(
        "role-chaining: true",
        "role-chaining: true\n          role-skip-session-tagging: true",
      ),
    ).includes("BETA_WORKFLOW_DNS_ROLE_INVALID"),
  );
});

test("rejects a combined or incomplete stack deployment session", () => {
  const combined = workflow
    .replace("CloudMarkup-beta/Observability \\", "--all \\")
    .replace("            --exclusively \\\n", "");
  assert.ok(codes(combined).includes("BETA_WORKFLOW_SPLIT_DEPLOY_INVALID"));

  const reordered = workflow
    .replace(
      "            CloudMarkup-beta/Stateful \\",
      "            __swap__ \\",
    )
    .replace(
      "            CloudMarkup-beta/Application \\",
      "            CloudMarkup-beta/Stateful \\",
    )
    .replace(
      "            __swap__ \\",
      "            CloudMarkup-beta/Application \\",
    );
  assert.notEqual(reordered, workflow);
  assert.ok(codes(reordered).includes("BETA_WORKFLOW_SPLIT_DEPLOY_INVALID"));
});

test("rejects physical CloudFormation names as CDK selectors", () => {
  for (const [selector, physicalName] of [
    ["CloudMarkup-beta/Observability", "cloudmarkup-beta-observability"],
    ["CloudMarkup-beta/Stateful", "cloudmarkup-beta-stateful"],
    ["CloudMarkup-beta/Application", "cloudmarkup-beta-application"],
    ["CloudMarkup-beta/Edge", "cloudmarkup-beta-edge"],
  ]) {
    const launcher =
      '          node "$bundle/runtime/aws-cdk/bin/cdk" deploy \\\n' +
      `            ${selector} \\`;
    const malformed = workflow.replace(
      launcher,
      `          # Selector decoy: ${selector}\n` +
        '          node "$bundle/runtime/aws-cdk/bin/cdk" deploy \\\n' +
        `            ${physicalName} \\`,
    );
    assert.notEqual(malformed, workflow);
    assert.ok(
      codes(malformed).includes("BETA_WORKFLOW_SPLIT_DEPLOY_INVALID"),
      physicalName,
    );
  }
});

test("rejects direct Route 53 mutation and requires validation CNAME preservation", () => {
  assert.ok(
    codes(
      workflow.replace(
        "aws cloudformation update-stack",
        "aws route53 change-resource-record-sets",
      ),
    ).includes("BETA_WORKFLOW_DIRECT_DNS_MUTATION"),
  );
  for (const parameter of [
    "ParameterKey=CertificateValidationRecordName,UsePreviousValue=true",
    "ParameterKey=CertificateValidationRecordValue,UsePreviousValue=true",
  ]) {
    assert.ok(
      codes(workflow.replace(parameter, "")).includes(
        "BETA_WORKFLOW_DNS_CLOUDFORMATION_INVALID",
      ),
    );
  }
});

test("rejects a DNS alias not bound to the deployed CloudFront output", () => {
  assert.ok(
    codes(
      workflow.replace(
        'ParameterKey=CloudFrontDomainName,ParameterValue="$dns_target"',
        "ParameterKey=CloudFrontDomainName,ParameterValue=unbound.cloudfront.net",
      ),
    ).includes("BETA_WORKFLOW_DNS_CLOUDFORMATION_INVALID"),
  );
  assert.ok(
    codes(
      workflow.replace("outputs.AliasTarget!==handoff.DnsTarget", "false"),
    ).includes("BETA_WORKFLOW_DNS_CLOUDFORMATION_INVALID"),
  );
});

test("rejects unsafe CDK or incomplete public smoke", () => {
  assert.ok(
    codes(workflow.replace("--require-approval never", "--hotswap")).includes(
      "BETA_WORKFLOW_UNSAFE_CDK_COMMAND",
    ),
  );
  assert.ok(
    codes(
      workflow.replace("$BETA_BASE_URL/api/runtime-config", "$BETA_BASE_URL"),
    ).includes("BETA_WORKFLOW_SMOKE_INVALID"),
  );
  assert.ok(
    codes(
      workflow.replace(
        "$BETA_BASE_URL/favicon.ico",
        "$BETA_BASE_URL/missing.ico",
      ),
    ).includes("BETA_WORKFLOW_SMOKE_INVALID"),
  );
  assert.ok(
    codes(
      workflow.replace(
        'cmp -s "$public_assets/site.webmanifest" "$reviewed_public_assets/site.webmanifest"',
        'cmp -s "$public_assets/site.webmanifest" "$reviewed_public_assets/missing.webmanifest"',
      ),
    ).includes("BETA_WORKFLOW_SMOKE_INVALID"),
  );
  assert.ok(
    codes(
      workflow.replace("cache-control:.*no-store", "cache-control"),
    ).includes("BETA_WORKFLOW_SMOKE_INVALID"),
  );
  assert.ok(
    codes(
      workflow.replace(
        "assert.deepStrictEqual(health, expectedHealth)",
        "void health",
      ),
    ).includes("BETA_WORKFLOW_SMOKE_INVALID"),
  );
  assert.ok(
    codes(
      workflow.replace(
        "assert.deepStrictEqual(readiness, expectedReadiness)",
        "void readiness",
      ),
    ).includes("BETA_WORKFLOW_SMOKE_INVALID"),
  );
  assert.ok(
    codes(
      workflow.replace(
        "assert.deepStrictEqual(actual, expected)",
        "void actual",
      ),
    ).includes("BETA_WORKFLOW_SMOKE_INVALID"),
  );
});

test("rejects checkout in the privileged deployment job", () => {
  const injected = workflow.replace(
    "      - name: Acquire the exact application deployment role through OIDC",
    "      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd\n      - name: Acquire the exact application deployment role through OIDC",
  );
  assert.ok(codes(injected).includes("BETA_WORKFLOW_APPLICATION_OIDC_INVALID"));
  assert.ok(codes(injected).includes("BETA_WORKFLOW_PRIVILEGED_CHECKOUT"));
});

test("prepares the real compiler before offline synthesis and quality with the identical CI pin", () => {
  const deployment = parse(workflow),
    ci = parse(readFileSync(".github/workflows/ci.yml", "utf8"));
  const name = "Build and pin the real compiler for integration tests";
  const step = deployment.jobs.prepare.steps.find((s) => s.name === name);
  assert.ok(step);
  assert.deepEqual(
    step,
    ci.jobs.quality.steps.find((s) => s.name === name),
  );
  for (const change of [
    (d) => {
      d.jobs.prepare.steps = d.jobs.prepare.steps.filter(
        (s) => s.name !== name,
      );
    },
    (d) => {
      d.jobs.prepare.steps.find((s) => s.name === name).run = "true";
    },
    (d) => {
      d.jobs.prepare.steps.find((s) => s.name === name).if = "false";
    },
    (d) => {
      d.jobs.prepare.steps.find((s) => s.name === name)["continue-on-error"] =
        true;
    },
  ]) {
    const changed = structuredClone(deployment);
    change(changed);
    assert.ok(
      codes(stringify(changed)).includes("BETA_WORKFLOW_PREPARE_ORDER_INVALID"),
    );
  }
});

test("rejects the Go library target and an omitted execution probe", () => {
  for (const mutate of [
    (run) => run.replace("./cmd/cloudmarkup-iac", "."),
    (run) =>
      run
        .split("\n")
        .filter((line) => !line.includes("verify-test-compiler.mjs"))
        .join("\n"),
  ]) {
    const changed = mutatePrepareSteps((steps) => {
      const step = steps.find(
        (s) =>
          s.name === "Build and pin the real compiler for integration tests",
      );
      step.run = mutate(step.run);
    });
    assert.ok(codes(changed).includes("BETA_WORKFLOW_PREPARE_ORDER_INVALID"));
  }
});

test("bounds preparation at 120 minutes while retaining the 90-minute AWS job", () => {
  for (const [job, timeout] of [
    ["prepare", 0],
    ["prepare", 121],
    ["deploy", 0],
    ["deploy", 91],
  ]) {
    const changed = parse(workflow);
    changed.jobs[job]["timeout-minutes"] = timeout;
    assert.ok(
      codes(stringify(changed)).includes("BETA_WORKFLOW_TIMEOUT_INVALID"),
    );
  }
});

const historicalCheckoutLabel =
  "Check out the exact historical AI receipt source";
const historicalPrepareLabel =
  "Prepare the closed historical AI receipt bundle";
const historicalWorkflowInputs = [
  // Routine and coverage commands share this exact workflow/job/validator.
  // Their distinct invocation wiring is checked below in the profile test.
  ["ci", "tests", parse(readFileSync(".github/workflows/ci.yml", "utf8"))],
];
for (const [label, jobName, original] of historicalWorkflowInputs) {
  test(
    label +
      " admits only the exact historical receipt preparation before full tests",
    () => {
      assert.doesNotThrow(() =>
        assertHistoricalAiReceiptPreparation(original, jobName),
      );
    },
  );
  const mutations = [
    [
      "duplicate named shard discovery",
      ({ steps }) => {
        steps.push({
          name: steps.find((step) => step.id === "historical").name,
          run: "echo unexpected-step",
        });
      },
    ],
    [
      "changed shard discovery",
      ({ steps }) => {
        steps.find((s) => s.id === "historical").run =
          "echo historical-required=false";
      },
    ],
    [
      "missing shard discovery",
      ({ steps }) => {
        steps.splice(
          steps.findIndex((s) => s.id === "historical"),
          1,
        );
      },
    ],
    [
      "ignored discovery failure",
      ({ steps }) => {
        steps.find((s) => s.id === "historical")["continue-on-error"] = true;
      },
    ],
    [
      "conditional shard discovery",
      ({ steps }) => {
        steps.find((s) => s.id === "historical").if = "false";
      },
    ],
    [
      "other immutable commit",
      ({ checkout }) => {
        checkout.with.ref = "0".repeat(40);
      },
    ],
    [
      "current source path",
      ({ checkout }) => {
        checkout.with.path = ".";
      },
    ],
    [
      "external repository",
      ({ checkout }) => {
        checkout.with.repository = "example/unreviewed";
      },
    ],
    [
      "retained credentials",
      ({ checkout }) => {
        checkout.with["persist-credentials"] = true;
      },
    ],
    [
      "submodule source",
      ({ checkout }) => {
        checkout.with.submodules = true;
      },
    ],
    [
      "LFS source",
      ({ checkout }) => {
        checkout.with.lfs = true;
      },
    ],
    [
      "unpinned action",
      ({ checkout }) => {
        checkout.uses = "actions/checkout@v6";
      },
    ],
    [
      "conditional source",
      ({ checkout }) => {
        checkout.if = "false";
      },
    ],
    [
      "source environment",
      ({ checkout }) => {
        checkout.env = { TOKEN: "unreviewed" };
      },
    ],
    [
      "skipped preparation",
      ({ preparation }) => {
        preparation.if = "false";
      },
    ],
    [
      "ignored preparation failure",
      ({ preparation }) => {
        preparation["continue-on-error"] = true;
      },
    ],
    [
      "different preparation command",
      ({ preparation }) => {
        preparation.run = "true";
      },
    ],
    [
      "changed preparation directory",
      ({ preparation }) => {
        preparation["working-directory"] = "other";
      },
    ],
    [
      "preparation credential environment",
      ({ preparation }) => {
        preparation.env = { TOKEN: "unreviewed" };
      },
    ],
    [
      "missing source",
      ({ steps, checkout }) => {
        steps.splice(steps.indexOf(checkout), 1);
      },
    ],
    [
      "missing preparation",
      ({ steps, preparation }) => {
        steps.splice(steps.indexOf(preparation), 1);
      },
    ],
    [
      "duplicate source",
      ({ steps, checkout }) => {
        steps.push(structuredClone(checkout));
      },
    ],
    [
      "duplicate preparation",
      ({ steps, preparation }) => {
        steps.push(structuredClone(preparation));
      },
    ],
    [
      "preparation after compiler",
      ({ steps, preparation }) => {
        steps.splice(steps.indexOf(preparation), 1);
        const compilerIndex = steps.findIndex(
          (step) =>
            step.name ===
            "Build and pin the real compiler for integration tests",
        );
        steps.splice(compilerIndex + 1, 0, preparation);
      },
    ],
    [
      "preparation in another job",
      ({ document, preparation }) => {
        const other = Object.entries(document.jobs).find(
          ([name]) => !["quality", "tests"].includes(name),
        )[1];
        other.steps.push(structuredClone(preparation));
      },
    ],
  ];
  for (const [caseName, mutate] of mutations) {
    test(label + " denies historical " + caseName, () => {
      const document = structuredClone(original),
        steps = document.jobs[jobName].steps;
      const checkout = steps.find(
        (step) => step.name === historicalCheckoutLabel,
      );
      const preparation = steps.find(
        (step) => step.name === historicalPrepareLabel,
      );
      mutate({ document, steps, checkout, preparation });
      assert.throws(
        () => assertHistoricalAiReceiptPreparation(document, jobName),
        /Historical AI receipt preparation/u,
      );
    });
  }
}
test("the historical shard explicitly fills its verified lock store before offline preparation", () => {
  const ci = parse(readFileSync(".github/workflows/ci.yml", "utf8"));
  const preparation = ci.jobs.tests.steps.find(
    (step) => step.name === historicalPrepareLabel,
  );
  assert.equal(
    preparation.run,
    "pnpm test:legacy-ai:prepare --fetch-dependencies",
  );
  preparation.run = "pnpm test:legacy-ai:prepare";
  assert.throws(
    () => assertHistoricalAiReceiptPreparation(ci, "tests"),
    /Historical AI receipt preparation/u,
  );
});

test("local release uses the same explicit preparation before any database quality gate", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(
    manifest.scripts["test:legacy-ai:prepare"],
    "node scripts/prepare-legacy-ai-receipt-closure.mjs",
  );
  assert.equal(
    manifest.scripts["test:legacy-ai:preparation"],
    "node --test scripts/prepare-legacy-ai-receipt-closure.test.mjs",
  );
  const commands = manifest.scripts["beta:release-gate"].split(" && ");
  assert.deepEqual(commands.slice(0, 3), [
    "pnpm beta:release-gate:policy",
    "pnpm test:legacy-ai:prepare",
    "pnpm check",
  ]);
  assert.equal(
    commands.filter((command) => command === "pnpm test:legacy-ai:prepare")
      .length,
    1,
  );
  assert.ok(
    manifest.scripts["beta:release-gate:test"].includes(
      "scripts/prepare-legacy-ai-receipt-closure.test.mjs",
    ),
  );
});

test("routine and diagnostic profiles both require uninstrumented SQL and SDK contracts", async () => {
  const ci = parse(readFileSync(".github/workflows/ci.yml", "utf8"));
  const { betaTestInvocation, runtimeFiles } =
    await import("./run-beta-tests.mjs");
  const normal = ci.jobs.tests.steps.find(
    (step) =>
      step.name === "Run selected tests without coverage instrumentation",
  );
  const coverage = ci.jobs.tests.steps.find((step) => step.id === "coverage");
  assert.equal(
    normal.if,
    "github.event_name != 'schedule' && github.event_name != 'workflow_dispatch'",
  );
  assert.equal(
    coverage.if,
    "github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'",
  );
  assert.equal(
    normal.run,
    "node scripts/run-beta-tests.mjs suite --shard=${{ matrix.shard }}/8",
  );
  assert.equal(
    coverage.run,
    "node scripts/run-beta-tests.mjs coverage --shard=${{ matrix.shard }}/8",
  );
  const runtime = ci.jobs.quality.steps.find(
    (step) => step.run === "pnpm test:beta:runtime",
  );
  assert.ok(runtime.env.CLOUDMARKUP_TEST_DATABASE_URL);
  assert.equal(Object.hasOwn(runtime, "if"), false);
  assert.equal(Object.hasOwn(runtime, "continue-on-error"), false);
  const invocation = betaTestInvocation("runtime", [], runtime.env);
  for (const file of runtimeFiles) assert.ok(invocation.command.includes(file));
  assert.equal(
    invocation.env.CLOUDMARKUP_TEST_DEFER_EXTENDED_MODEL_ACCOUNTING,
    "false",
  );
  assert.equal(Object.hasOwn(ci.jobs.tests, "continue-on-error"), false);
});

test("release preparation only reuses this verified run's build cache", () => {
  const original = parse(workflow);
  assert.deepEqual(original.jobs.prepare.needs, ["changes", "verify"]);
  for (const mutate of [
    (d) => {
      d.jobs.prepare.needs = "changes";
    },
    (d) => {
      d.jobs.prepare.steps.find(
        (s) => s.name === "Restore this release's verified build cache",
      ).with["run-id"] = 123;
    },
    (d) => {
      d.jobs.prepare.steps.find(
        (s) => s.name === "Restore this release's verified build cache",
      ).with.name = "old-release";
    },
    (d) => {
      d.jobs.prepare.steps.find(
        (s) => s.name === "Restore this release's verified build cache",
      )["continue-on-error"] = true;
    },
    (d) => {
      d.jobs.prepare.steps.find(
        (s) => s.name === "Restore this release's verified build cache",
      ).if = "false";
    },
    (d) => {
      d.jobs.prepare.steps = d.jobs.prepare.steps.filter(
        (s) => s.name !== "Restore this release's verified build cache",
      );
    },
  ]) {
    const changed = structuredClone(original);
    mutate(changed);
    assert.ok(codes(stringify(changed)).length > 0);
  }
});

test("test-only preflight cannot bypass a deployable push", () => {
  const mutations = [
    (d) => {
      delete d.jobs.changes;
    },
    (d) => {
      d.jobs.changes.steps[0].with["fetch-depth"] = 1;
    },
    (d) => {
      d.jobs.changes.steps[0].with["persist-credentials"] = true;
    },
    (d) => {
      d.jobs.changes.steps[1].run = "echo deploy-required=false";
    },
    (d) => {
      d.jobs.changes.steps[1].env.BEFORE_SHA = "";
    },
    (d) => {
      d.jobs.verify.needs = [];
    },
    (d) => {
      d.jobs.prepare.needs = [];
    },
    (d) => {
      d.jobs.prepare.if = "false";
    },
  ];
  for (const mutate of mutations) {
    const altered = parse(workflow);
    mutate(altered);
    assert.ok(
      codes(stringify(altered)).some((code) =>
        [
          "BETA_WORKFLOW_CHANGES_INVALID",
          "BETA_WORKFLOW_VERIFY_INVALID",
          "BETA_WORKFLOW_PREPARE_BOUNDARY_INVALID",
        ].includes(code),
      ),
    );
  }
});

test("delivery skips documentation-only changes without excluding executable inputs", () => {
  const document = parse(workflow);
  assert.deepEqual(document.on.push["paths-ignore"], [
    "docs/**",
    "**/README.md",
    "README.md",
    "**/AGENTS.md",
    "AGENTS.md",
    ".agents/skills/**",
  ]);
  assert.deepEqual(codes(workflow), []);
  for (const forbidden of [
    "apps/**",
    "packages/**",
    "**/*.md",
    "scripts/**",
    ".github/**",
    "services/**",
  ]) {
    const altered = structuredClone(document);
    altered.on.push["paths-ignore"].push(forbidden);
    assert.ok(
      codes(stringify(altered)).includes("BETA_WORKFLOW_TRIGGER_INVALID"),
    );
  }
});

test("deployment history uses only the exact ephemeral read-only classification token", () => {
  const document = parse(workflow);
  assert.deepEqual(document.jobs.changes.permissions, {
    contents: "read",
    actions: "read",
  });
  assert.equal(
    document.jobs.changes.steps[1].env.GITHUB_TOKEN,
    "${{ github.token }}",
  );
  for (const mutate of [
    (d) => {
      d.jobs.changes.permissions.actions = "write";
    },
    (d) => {
      d.jobs.changes.permissions["id-token"] = "write";
    },
    (d) => {
      d.jobs.changes.steps[1].env.GITHUB_TOKEN = "${{ secrets.DEPLOY_TOKEN }}";
    },
    (d) => {
      delete d.jobs.changes.steps[1].env.GITHUB_TOKEN;
    },
  ]) {
    const changed = parse(workflow);
    mutate(changed);
    assert.ok(
      codes(stringify(changed)).includes("BETA_WORKFLOW_CHANGES_INVALID"),
    );
  }
});
