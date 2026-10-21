import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const commitPattern = /^[0-9a-f]{40}$/u;
const contributorDocumentationPaths = new Set([
  "README.md",
  "AGENTS.md",
  "evals/README.md",
  "scripts/README.md",
  "infra/platform/README.md",
  "infra/platform/AGENTS.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "BETA_READINESS.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
]);

export function isDocumentationPath(path) {
  if (
    typeof path !== "string" ||
    path.includes("\\") ||
    [...path].some(
      (character) =>
        character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f,
    ) ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    return false;
  return (
    contributorDocumentationPaths.has(path) ||
    /^docs\/.+\.md$/u.test(path) ||
    /^(?:apps|packages|services)\/[^/]+\/(?:README|AGENTS)\.md$/u.test(path)
  );
}

export function isDocumentationDiff(bytes) {
  if (!Buffer.isBuffer(bytes))
    throw new Error("Expected raw NUL-delimited Git diff bytes.");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!text || !text.endsWith("\0")) return false;
  const records = text.slice(0, -1).split("\0");
  if (records.length % 2 !== 0) throw new Error("Incomplete Git diff record.");
  for (let index = 0; index < records.length; index += 2) {
    const match =
      /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z])$/u.exec(
        records[index],
      );
    if (!match) throw new Error("Malformed Git diff record.");
    const [, beforeMode, afterMode, , , status] = match;
    const modes = {
      A: ["000000", "100644"],
      D: ["100644", "000000"],
      M: ["100644", "100644"],
    };
    const expected = modes[status];
    if (
      !expected ||
      beforeMode !== expected[0] ||
      afterMode !== expected[1] ||
      !isDocumentationPath(records[index + 1])
    )
      return false;
  }
  return true;
}

export function documentationOnlyPullRequest(
  { event, base, head },
  git = execFileSync,
) {
  if (event !== "pull_request") return false;
  if (
    !commitPattern.test(base ?? "") ||
    !commitPattern.test(head ?? "") ||
    /^0+$/u.test(base) ||
    /^0+$/u.test(head)
  )
    return false;
  if (git("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() !== head)
    throw new Error("Checkout does not match the triggering revision.");
  try {
    git("git", ["merge-base", "--is-ancestor", base, head], { stdio: "pipe" });
  } catch {
    return false;
  }
  return isDocumentationDiff(
    git("git", [
      "diff",
      "--raw",
      "--no-abbrev",
      "--no-renames",
      "-z",
      base,
      head,
    ]),
  );
}

// An empty selection always means the complete suite, never "no tests".
// Accept only the literal project definitions used by this repository. New
// config forms fail closed until the selector understands their include rules.
export function readVitestProjects(source) {
  const section = /projects:\s*\[([\s\S]*?)\],\s*restoreMocks:/u.exec(
    source,
  )?.[1];
  if (!section) throw new Error("Unknown Vitest project configuration.");
  const projects = [];
  const remaining = section.replace(
    /\{\s*extends:\s*true,\s*test:\s*\{([\s\S]*?)\},\s*\}/gu,
    (_block, body) => {
      const fields = body.replace(/\/\/[^\r\n]*/gu, "");
      const keys = [
        ...fields.matchAll(
          /\b(name|include|root|environment|hookTimeout|setupFiles):/gu,
        ),
      ].map((match) => match[1]);
      if (new Set(keys).size !== keys.length)
        throw new Error("Duplicate Vitest project controls.");
      const name = /name:\s*"([a-z][a-z0-9-]*)",/u.exec(fields)?.[1];
      const include = /include:\s*\[([^\]]+)\],/u.exec(fields)?.[1];
      const root =
        /root:\s*fileURLToPath\(\s*new URL\("\.\/([^"]+)", import\.meta\.url\),?\s*\),/u.exec(
          fields,
        )?.[1];
      const repositoryRoot = /root:\s*repositoryRoot,/u.test(fields);
      if (!name || !include || (!root && !repositoryRoot))
        throw new Error("Unknown Vitest project definition.");
      const patterns = [...include.matchAll(/"([^"]+)"/gu)].map(
        (match) => match[1],
      );
      if (!patterns.length || include.replace(/"[^"]+"|[,\s]/gu, ""))
        throw new Error("Unknown Vitest include rules.");
      const unknownFields = fields
        .replace(/name:\s*"[a-z][a-z0-9-]*",/gu, "")
        .replace(/include:\s*\[[^\]]+\],/gu, "")
        .replace(
          /root:\s*(?:repositoryRoot|fileURLToPath\(\s*new URL\("\.\/[^"\r\n]+", import\.meta\.url\),?\s*\)),/gu,
          "",
        )
        .replace(/environment:\s*"(?:node|jsdom)",/gu, "")
        .replace(/hookTimeout:\s*[0-9_]+,/gu, "")
        .replace(/setupFiles:\s*\["\.\/src\/test\/setup\.ts"\],/gu, "")
        .trim();
      if (unknownFields) throw new Error("Unknown Vitest project controls.");
      const includes = patterns.map((pattern) =>
        root ? `${root}/${pattern}` : pattern,
      );
      if (
        includes.some(
          (pattern) =>
            !/^(?:apps|packages|infra)\/[^/]+\/(?:src|lib|test)\/\*\*\/\*\.test\.(?:ts|\{ts,tsx\})$/u.test(
              pattern,
            ),
        )
      )
        throw new Error("Unknown Vitest test boundary.");
      projects.push({ name, includes });
      return "";
    },
  );
  if (
    remaining.replace(/[,\s]/gu, "") ||
    !projects.length ||
    new Set(projects.map(({ name }) => name)).size !== projects.length
  )
    throw new Error("Incomplete Vitest project configuration.");
  return projects;
}

function changedPaths(bytes) {
  if (!Buffer.isBuffer(bytes))
    throw new Error("Expected raw NUL-delimited Git diff bytes.");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!text || !text.endsWith("\0")) return null;
  const records = text.slice(0, -1).split("\0");
  if (records.length % 2) throw new Error("Incomplete Git diff record.");
  const paths = [];
  for (let index = 0; index < records.length; index += 2) {
    const match =
      /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z])$/u.exec(
        records[index],
      );
    if (!match) throw new Error("Malformed Git diff record.");
    const [, before, after, , , status] = match;
    const modes = {
      A: ["000000", "100644"],
      D: ["100644", "000000"],
      M: ["100644", "100644"],
    };
    if (
      !modes[status] ||
      before !== modes[status][0] ||
      after !== modes[status][1]
    )
      return null;
    const path = records[index + 1];
    if (
      !path ||
      path.includes("\\") ||
      [...path].some(
        (character) =>
          character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f,
      ) ||
      path.split("/").some((part) => !part || part === "." || part === "..")
    )
      return null;
    paths.push(path);
  }
  return paths;
}

/** Operator caller/archive checks have a different boundary from Vitest
 * projects. Uncertain history runs them; an exact unrelated diff can omit them. */
export function selfHostToolingForRevision(
  { event, base, head, functionalBeta = false },
  git = execFileSync,
) {
  if (typeof functionalBeta !== "boolean")
    throw new Error("Functional beta verification must be a boolean.");
  // A corrective push cannot prove the complete pending release scope.
  if (functionalBeta) return true;
  if (
    !["pull_request", "push"].includes(event) ||
    !commitPattern.test(base ?? "") ||
    !commitPattern.test(head ?? "") ||
    /^0+$/u.test(base) ||
    /^0+$/u.test(head)
  )
    return true;
  try {
    if (git("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() !== head)
      return true;
    git("git", ["merge-base", "--is-ancestor", base, head], { stdio: "pipe" });
    const paths = changedPaths(
      git("git", [
        "diff",
        "--raw",
        "--no-abbrev",
        "--no-renames",
        "-z",
        base,
        head,
      ]),
    );
    if (!paths?.length) return true;
    return paths.some(
      (path) =>
        /^scripts\/self-host\//u.test(path) ||
        /^apps\/api\/(?:migrations|self-host-migrations|authorization-proposals|src\/(?:self-host|adapters\/persistence))(?:\/|$)/u.test(
          path,
        ) ||
        /^apps\/api\/src\/(?:persistence|self-host-owner)\.ts$/u.test(path) ||
        /(?:^|\/)(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|AGENTS\.md|SECURITY\.md)$/u.test(
          path,
        ) ||
        /^\.github\/workflows\//u.test(path) ||
        /^scripts\/(?:security\/|(?:ci-change-scope|validate-workflows|verify-security-static|scan-secrets)\.)/u.test(
          path,
        ) ||
        [
          ".node-version",
          ".env.example",
          "services/iac-compiler/go.mod",
        ].includes(path),
    );
  } catch {
    return true;
  }
}

export function impactedTestProjects(bytes, { packages, projects, files }) {
  const paths = changedPaths(bytes);
  if (
    !paths?.length ||
    !packages?.length ||
    !projects?.length ||
    !files?.length
  )
    return [];
  const byName = new Map();
  const roots = new Set();
  const dependents = new Map();
  for (const { root, manifest } of packages) {
    if (
      !/^(?:apps|packages|infra)\/[^/]+$/u.test(root) ||
      typeof manifest?.name !== "string" ||
      byName.has(manifest.name) ||
      roots.has(root)
    )
      return [];
    byName.set(manifest.name, root);
    roots.add(root);
    dependents.set(manifest.name, new Set());
  }
  for (const { manifest } of packages) {
    for (const field of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ]) {
      const dependencies = manifest[field] ?? {};
      if (
        !dependencies ||
        typeof dependencies !== "object" ||
        Array.isArray(dependencies)
      )
        return [];
      for (const [name, version] of Object.entries(dependencies)) {
        if (
          typeof version !== "string" ||
          (version.startsWith("workspace:") && !byName.has(name))
        )
          return [];
        if (byName.has(name)) dependents.get(name).add(manifest.name);
      }
    }
  }
  const affected = new Set();
  for (const path of paths) {
    // Shared build/test controls and security contracts require full evidence.
    if (
      /(?:^|\/)(?:scripts|config|patches)(?:\/|$)/u.test(path) ||
      /(?:^|\/)(?:\.[^/]+|AGENTS\.md|SECURITY\.md|package\.json|package-lock\.json|yarn\.lock|bun\.lockb?|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig[^/]*|[^/]*\.config\.[^/]+)$/u.test(
        path,
      ) ||
      /\.(?:mjs|cjs|sh|ps1|cmd|bat|ya?ml)$/u.test(path) ||
      /(?:^|[/._-])(?:auth(?:entication|orization)?|oauth|oidc|cognito|session[s]?|permission[s]?|tenant|billing|payment[s]?|credit[s]?|accounting|migration[s]?|persistence|database|data|schemas?|security|secret[s]?|identity|credential[s]?|recovery)(?:[/._-]|$)/iu.test(
        path,
      )
    )
      return [];
    if (isDocumentationPath(path)) continue;
    const owner = packages.find(({ root }) => path.startsWith(`${root}/`));
    if (!owner) return [];
    affected.add(owner.manifest.name);
  }
  for (const name of affected) {
    for (const dependent of dependents.get(name)) affected.add(dependent);
  }
  const affectedRoots = [...affected].map((name) => byName.get(name));
  const selected = projects.filter(({ includes }) =>
    includes.some((pattern) =>
      affectedRoots.some((root) => pattern.startsWith(`${root}/`)),
    ),
  );
  if (
    !selected.length ||
    selected.some(
      ({ includes }) =>
        !files.some((file) =>
          includes.some((pattern) => posix.matchesGlob(file, pattern)),
        ),
    )
  )
    return [];
  // A workspace package may supply shared fixtures without its own tests. But
  // existing tests outside configured projects must never be silently omitted.
  for (const root of affectedRoots) {
    for (const file of files.filter(
      (path) =>
        path.startsWith(`${root}/`) && /\.test\.(?:ts|tsx)$/u.test(path),
    )) {
      if (
        !selected.some(({ includes }) =>
          includes.some((pattern) => posix.matchesGlob(file, pattern)),
        )
      )
        return [];
    }
  }
  return selected.map(({ name }) => name).sort();
}

function readTestWorkspace(head, git) {
  const read = (path) =>
    git("git", ["show", `${head}:${path}`], { encoding: "utf8" });
  const files = new TextDecoder("utf-8", { fatal: true })
    .decode(git("git", ["ls-tree", "-r", "--name-only", "-z", head]))
    .split("\0")
    .filter(Boolean);
  const workspaceSection =
    /^packages:\s*\r?\n((?:[ \t]+[^\r\n]*\r?\n)+)/mu.exec(
      read("pnpm-workspace.yaml"),
    )?.[1];
  const patterns = workspaceSection
    ?.trim()
    .split(/\r?\n/u)
    .map(
      (line) => /^\s*- "((?:apps|packages|infra)\/\*)"\s*$/u.exec(line)?.[1],
    );
  if (!patterns?.length || patterns.some((pattern) => !pattern))
    throw new Error("Unknown workspace package boundaries.");
  const packages = files
    .filter(
      (path) =>
        path.endsWith("/package.json") &&
        patterns.some((pattern) =>
          posix.matchesGlob(path.slice(0, -13), pattern),
        ),
    )
    .map((path) => ({
      root: path.slice(0, -13),
      manifest: JSON.parse(read(path)),
    }));
  return {
    packages,
    projects: readVitestProjects(read("vitest.config.ts")),
    files,
  };
}

export function testProjectsForRevision(
  { event, base, head, functionalBeta = false },
  git = execFileSync,
) {
  if (typeof functionalBeta !== "boolean")
    throw new Error("Functional beta verification must be a boolean.");
  if (
    !["pull_request", "push"].includes(event) ||
    !commitPattern.test(base ?? "") ||
    !commitPattern.test(head ?? "") ||
    /^0+$/u.test(base) ||
    /^0+$/u.test(head)
  )
    return [];
  if (git("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() !== head)
    throw new Error("Checkout does not match the triggering revision.");
  // A corrective push can follow an incomplete release, so its immediate diff
  // cannot establish coverage of the full pending deployment candidate.
  if (functionalBeta) return [];
  try {
    git("git", ["merge-base", "--is-ancestor", base, head], { stdio: "pipe" });
    const bytes = git("git", [
      "diff",
      "--raw",
      "--no-abbrev",
      "--no-renames",
      "-z",
      base,
      head,
    ]);
    return impactedTestProjects(bytes, readTestWorkspace(head, git));
  } catch {
    return [];
  }
}

export function assertCiResults(jobs, draft) {
  if (draft !== "false")
    throw new Error(
      "Draft or unknown review state is not merge verification. Mark the PR ready to run complete checks.",
    );
  const names = [
    "browser",
    "build",
    "changes",
    "documentation",
    "lint",
    "quality",
    "security",
    "tests",
  ];
  if (
    !jobs ||
    JSON.stringify(Object.keys(jobs).sort()) !== JSON.stringify(names)
  )
    throw new Error("Incomplete CI dependency results.");
  const scope = jobs.changes.outputs?.["documentation-only"];
  if (jobs.changes.result !== "success" || !["true", "false"].includes(scope))
    throw new Error("CI change classification did not succeed.");
  for (const name of names) {
    const required =
      name === "changes" ||
      name === "security" ||
      (scope === "true" ? name === "documentation" : name !== "documentation");
    if (jobs[name].result !== (required ? "success" : "skipped"))
      throw new Error(`Required CI result missing for ${name}.`);
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.length === 3 && process.argv[2] === "gate") {
    assertCiResults(
      JSON.parse(process.env.RESULTS ?? "null"),
      process.env.PULL_REQUEST_DRAFT ?? "unknown",
    );
  } else if (process.argv.length === 2) {
    const functionalBetaValue =
      process.env.CLOUDMARKUP_FUNCTIONAL_BETA ?? "false";
    if (!["true", "false"].includes(functionalBetaValue))
      throw new Error("Invalid functional beta verification signal.");
    const functionalBeta = functionalBetaValue === "true";
    const result = functionalBeta
      ? false
      : documentationOnlyPullRequest({
          event: process.env.GITHUB_EVENT_NAME,
          base: process.env.BASE_SHA,
          head: process.env.GITHUB_SHA,
        });
    if (!process.env.GITHUB_OUTPUT)
      throw new Error("Missing GitHub output path.");
    appendFileSync(process.env.GITHUB_OUTPUT, `documentation-only=${result}\n`);
    const projects = testProjectsForRevision({
      event: process.env.GITHUB_EVENT_NAME,
      base: process.env.BASE_SHA,
      head: process.env.GITHUB_SHA,
      functionalBeta,
    });
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `test-projects=${JSON.stringify(projects)}\n`,
    );
    const selfHostTooling = selfHostToolingForRevision({
      event: process.env.GITHUB_EVENT_NAME,
      base: process.env.BASE_SHA,
      head: process.env.GITHUB_SHA,
      functionalBeta,
    });
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `self-host-tooling=${selfHostTooling}\n`,
    );
    console.log(
      result
        ? "Documentation-only verification."
        : "Complete source verification required.",
    );
  } else {
    throw new Error("Expected no arguments or the gate command.");
  }
}
