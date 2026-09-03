import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type ProtectedBaselineManifest = Readonly<{
  schemaVersion: "game-ir-protected-baseline.v2";
  baselineCommit: "d821e286ebf7eb3ad1b4725ae60dac7a9fef95b6";
  stableBranchCommit: "70df2e2c79bd214862af3959a257c5f5f42bd666";
  firstGameIrBoundaryCommit: "109e7195d314bb716922ef2dd2de65567e428d64";
  firstGameIrProductionCommit: "f4a7d16f7bde3bb8a978f1a10350ad2cef84aa8f";
  sourceCommit: "4335363b2cd33d1f0b7bd807bff95d9389c67ce1";
  quarantinedPrefix: "packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/";
  protectedPaths: readonly Readonly<{ path: string; blobId: string }>[];
  admittedTestCorrections: readonly Readonly<{
    path: string;
    baselineBlobId: string;
    correctedBlobId: string;
    reason: string;
    failureEvidencePath: string;
  }>[];
  changedOutsideQuarantine: readonly string[];
  trackedScratchPaths: readonly string[];
  historicalEvidence: readonly Readonly<{ path: string; commit: string; claim: string }>[];
  historicalEvidenceGap: "no baseline-bound Revision-to-zero-and-Checklist Chrome receipt found";
}>;

export type BoundaryViolationCode =
  | "invalid_baseline_ancestry"
  | "baseline_manifest_mismatch"
  | "protected_blob_mismatch"
  | "missing_protected_path"
  | "unexpected_protected_path"
  | "game_ir_source_present"
  | "game_ir_reference_in_protected_source"
  | "tracked_sdd_scratch";

export type BoundaryViolation = Readonly<{
  code: BoundaryViolationCode;
  path?: string;
  detail?: string;
}>;

export type BoundaryReport = Readonly<{
  violations: readonly BoundaryViolation[];
}>;

const EXPECTED_AUTHORITY = {
  schemaVersion: "game-ir-protected-baseline.v2",
  baselineCommit: "d821e286ebf7eb3ad1b4725ae60dac7a9fef95b6",
  stableBranchCommit: "70df2e2c79bd214862af3959a257c5f5f42bd666",
  firstGameIrBoundaryCommit: "109e7195d314bb716922ef2dd2de65567e428d64",
  firstGameIrProductionCommit: "f4a7d16f7bde3bb8a978f1a10350ad2cef84aa8f",
  sourceCommit: "4335363b2cd33d1f0b7bd807bff95d9389c67ce1",
  quarantinedPrefix: "packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/",
  historicalEvidenceGap: "no baseline-bound Revision-to-zero-and-Checklist Chrome receipt found",
} as const;

const EXPECTED_TEST_CORRECTIONS = [
  {
    path: "packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts",
    baselineBlobId: "4c1d39384afdf7b3b8d07f914da998be21713c3b",
    correctedBlobId: "c2095a88a3d848821a1f991c0d09611bc5043d12",
    reason: "replace obsolete Checklist fixture with the canonical section-reference form",
    failureEvidencePath: "docs/superpowers/evidence/2026-09-03-stable-workflow-local-verification.md",
  },
  {
    path: "packages/agent-workflow-server/src/beegame/delivery-workflow/workflow-stage-card-history.test.ts",
    baselineBlobId: "c6af90e108c5c7b190bb3fd138af25f25ab4bfd8",
    correctedBlobId: "80aefe9c1b8ef2fa439af8b27bb2b25087b08400",
    reason: "derive display phase count from DELIVERY_PROGRESS_STAGES",
    failureEvidencePath: "docs/superpowers/evidence/2026-09-03-stable-workflow-local-verification.md",
  },
  {
    path: "packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-runtime.integration.test.ts",
    baselineBlobId: "af2cd7c90d05b08b105bc907c3bd51c2bf1f2b51",
    correctedBlobId: "724597486bd5afdceada734bbdbb7ee1a168e232",
    reason: "await the automatic onRetryable retry task to become durably running",
    failureEvidencePath: "docs/superpowers/evidence/2026-09-03-stable-workflow-local-verification.md",
  },
  {
    path: "packages/agent-workflow-server/src/__tests__/workflow-stage-snapshot-projection.test.ts",
    baselineBlobId: "e7c0659f2b59eea75c2b8fe95a0b75be2380816d",
    correctedBlobId: "a847be0ee6f4481a17d9c88a8fbb315e6abd4e97",
    reason: "derive snapshot fixture phase count from DELIVERY_PROGRESS_STAGES",
    failureEvidencePath: "docs/superpowers/evidence/2026-09-03-stable-workflow-local-verification.md",
  },
  {
    path: "packages/agent-workflow-server/src/__tests__/session-routes.test.ts",
    baselineBlobId: "8c9c7cb701071d06f222225b1b691cd6fd67b33d",
    correctedBlobId: "57cdfa88f45d514a4e644c0470ee578d85fe5f23",
    reason: "derive frozen stage fixture phase count from DELIVERY_PROGRESS_STAGES",
    failureEvidencePath: "docs/superpowers/evidence/2026-09-03-stable-workflow-local-verification.md",
  },
] as const;

const EXPECTED_HISTORICAL_EVIDENCE = [
  {
    path: "docs/superpowers/reviews/2026-08-13-foundation-document-streaming-chrome-acceptance.md",
    commit: "5254d695d5fc550dc02ed08199799dc35a7b0e6b",
  },
  {
    path: "docs/superpowers/reviews/2026-08-17-reviewer-read-only-capability-chrome-acceptance.md",
    commit: "26f05cf03574793b542d856d1eaacc759ccbeda4",
  },
] as const;

const EXPECTED_MANIFEST_KEYS = [
  "admittedTestCorrections",
  "baselineCommit",
  "changedOutsideQuarantine",
  "firstGameIrBoundaryCommit",
  "firstGameIrProductionCommit",
  "historicalEvidence",
  "historicalEvidenceGap",
  "protectedPaths",
  "quarantinedPrefix",
  "schemaVersion",
  "sourceCommit",
  "stableBranchCommit",
  "trackedScratchPaths",
] as const;

const runtimeRoot = "packages/agent-workflow-server/src/beegame/";
const testsRoot = "packages/agent-workflow-server/src/__tests__/";
const gameIrReference = /GAME_IR|GameIr|gameIr|game-ir/;

function git(root: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function gitSucceeds(root: string, args: string[]): boolean {
  try {
    git(root, args);
    return true;
  } catch {
    return false;
  }
}

export function baselineBlobMatchesGitTree(
  root: string,
  baselineCommit: string,
  path: string,
  blobId: string,
): boolean {
  try {
    return git(root, ["rev-parse", `${baselineCommit}:${path}`]) === blobId;
  } catch {
    return false;
  }
}

function validateManifest(root: string, value: unknown): BoundaryViolation[] {
  const mismatch = (detail: string): BoundaryViolation[] => [
    { code: "baseline_manifest_mismatch", detail },
  ];
  const hasExactKeys = (entry: object, expected: readonly string[]): boolean => {
    const keys = Object.keys(entry).sort();
    return keys.length === expected.length && expected.every((key, index) => keys[index] === key);
  };
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return mismatch("manifest must be an object");
  }
  const manifest = value as Record<string, unknown>;
  const keys = Object.keys(manifest).sort();
  if (
    keys.length !== EXPECTED_MANIFEST_KEYS.length ||
    EXPECTED_MANIFEST_KEYS.some((key, index) => keys[index] !== key)
  ) {
    return mismatch("manifest top-level keys do not match the schema exactly");
  }
  for (const [key, expected] of Object.entries(EXPECTED_AUTHORITY)) {
    if (manifest[key] !== expected) {
      return mismatch(`manifest authority field ${key} does not match fixed authority`);
    }
  }
  for (const key of [
    "protectedPaths",
    "changedOutsideQuarantine",
    "trackedScratchPaths",
    "historicalEvidence",
  ]) {
    if (!Array.isArray(manifest[key])) return mismatch(`${key} must be an array`);
  }
  if (
    !(manifest.protectedPaths as unknown[]).every(
      (entry) =>
        entry !== null &&
        typeof entry === "object" &&
        hasExactKeys(entry, ["blobId", "path"]) &&
        typeof (entry as Record<string, unknown>).path === "string" &&
        typeof (entry as Record<string, unknown>).blobId === "string",
    ) ||
    !(manifest.changedOutsideQuarantine as unknown[]).every(
      (entry) => typeof entry === "string",
    ) ||
    !(manifest.trackedScratchPaths as unknown[]).every(
      (entry) => typeof entry === "string",
    )
  ) {
    return mismatch("manifest path arrays have invalid entries");
  }
  const corrections = manifest.admittedTestCorrections;
  if (
    !Array.isArray(corrections) ||
    corrections.length !== EXPECTED_TEST_CORRECTIONS.length ||
    !corrections.every(
      (entry) =>
        entry !== null &&
        typeof entry === "object" &&
        hasExactKeys(entry, ["baselineBlobId", "correctedBlobId", "failureEvidencePath", "path", "reason"]) &&
        typeof (entry as Record<string, unknown>).path === "string" &&
        typeof (entry as Record<string, unknown>).baselineBlobId === "string" &&
        typeof (entry as Record<string, unknown>).correctedBlobId === "string" &&
        typeof (entry as Record<string, unknown>).reason === "string" &&
        (entry as Record<string, unknown>).reason !== "" &&
        typeof (entry as Record<string, unknown>).failureEvidencePath === "string" &&
        (entry as Record<string, unknown>).failureEvidencePath !== "",
    )
  ) {
    return mismatch("admittedTestCorrections must contain exactly the five correction records");
  }
  for (const [index, expected] of EXPECTED_TEST_CORRECTIONS.entries()) {
    const entry = corrections[index] as Record<string, string>;
    if (
      entry.path !== expected.path ||
      entry.baselineBlobId !== expected.baselineBlobId ||
      entry.correctedBlobId !== expected.correctedBlobId ||
      entry.reason !== expected.reason ||
      entry.failureEvidencePath !== expected.failureEvidencePath
    ) {
      return mismatch("admittedTestCorrections must match the fixed ordered allowlist");
    }
    if (!gitSucceeds(root, ["cat-file", "-e", `${EXPECTED_AUTHORITY.baselineCommit}:${entry.path}`])) {
      return mismatch("admitted test correction path is absent from the baseline tree");
    }
    if (!baselineBlobMatchesGitTree(root, EXPECTED_AUTHORITY.baselineCommit, entry.path, entry.baselineBlobId)) {
      return mismatch("admitted test correction baseline blob does not match the baseline tree");
    }
    if (!gitSucceeds(root, ["cat-file", "-e", entry.correctedBlobId])) {
      return mismatch("admitted test correction blob is unavailable");
    }
  }
  const evidence = manifest.historicalEvidence as unknown[];
  if (
    evidence.length !== EXPECTED_HISTORICAL_EVIDENCE.length ||
    !evidence.every(
      (entry) =>
        entry !== null &&
        typeof entry === "object" &&
        hasExactKeys(entry, ["claim", "commit", "path"]) &&
        typeof (entry as Record<string, unknown>).path === "string" &&
        typeof (entry as Record<string, unknown>).commit === "string" &&
        typeof (entry as Record<string, unknown>).claim === "string" &&
        (entry as Record<string, unknown>).claim !== "",
    )
  ) {
    return mismatch("historicalEvidence must contain the two audited records");
  }
  for (const [index, expected] of EXPECTED_HISTORICAL_EVIDENCE.entries()) {
    const entry = evidence[index] as Record<string, string>;
    if (entry.path !== expected.path || entry.commit !== expected.commit) {
      return mismatch("historicalEvidence path/commit tuple does not match fixed evidence");
    }
    if (!gitSucceeds(root, ["cat-file", "-e", `${EXPECTED_AUTHORITY.baselineCommit}:${entry.path}`])) {
      return mismatch("historicalEvidence path is absent from the baseline tree");
    }
    if (!gitSucceeds(root, ["merge-base", "--is-ancestor", entry.commit, EXPECTED_AUTHORITY.baselineCommit])) {
      return mismatch("historicalEvidence commit is not an ancestor of the baseline");
    }
  }
  return [];
}

function trackedPaths(root: string): string[] {
  const output = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return output.split("\0").filter(Boolean);
}

function stagedTrackedPaths(root: string): string[] {
  const output = execFileSync("git", ["ls-files", "--cached", "-z"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return output.split("\0").filter(Boolean);
}

function treeEntries(
  root: string,
  commit: string,
  prefixes: string[],
): Map<string, string> {
  const output = git(root, ["ls-tree", "-r", commit, "--", ...prefixes]);
  const entries = new Map<string, string>();
  for (const line of output.split("\n").filter(Boolean)) {
    const tab = line.indexOf("\t");
    const fields = line.slice(0, tab).split(/\s+/);
    entries.set(line.slice(tab + 1), fields[2]);
  }
  return entries;
}

function workingTreeBlobs(root: string, paths: readonly string[]): Map<string, string> {
  const existingPaths = paths.filter((path) => existsSync(join(root, path)));
  if (existingPaths.length === 0) return new Map();
  try {
    const hashes = git(root, ["hash-object", "--no-filters", "--", ...existingPaths])
      .split("\n")
      .filter(Boolean);
    return new Map(existingPaths.map((path, index) => [path, hashes[index]]));
  } catch {
    return new Map();
  }
}

function sortedDiffPaths(root: string, manifest: ProtectedBaselineManifest): string[] {
  return git(root, [
    "diff",
    "--name-only",
    EXPECTED_AUTHORITY.baselineCommit,
    EXPECTED_AUTHORITY.sourceCommit,
  ])
    .split("\n")
    .filter(Boolean)
    .filter((path) => isProtectedPath(path, EXPECTED_AUTHORITY.quarantinedPrefix))
    .sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));
}

function sortedScratchDiffPaths(
  root: string,
  _manifest: ProtectedBaselineManifest,
): string[] {
  return git(root, [
    "diff",
    "--name-only",
    EXPECTED_AUTHORITY.baselineCommit,
    EXPECTED_AUTHORITY.sourceCommit,
    "--",
    ".superpowers/sdd/",
  ])
    .split("\n")
    .filter(Boolean)
    .sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));
}

function compareManifestList(
  expected: readonly string[],
  actual: readonly string[],
  violations: BoundaryViolation[],
  detail: string,
): void {
  const sortedActual = [...actual].sort((a, b) =>
    Buffer.from(a).compare(Buffer.from(b)),
  );
  const exact =
    expected.length === actual.length &&
    expected.every((path, index) => path === actual[index]);
  if (!exact || sortedActual.some((path, index) => path !== actual[index])) {
    violations.push({
      code: "baseline_manifest_mismatch",
      detail: `${detail}: manifest must equal the sorted Git range exactly`,
    });
  }
}

function isProtectedPath(path: string, quarantinedPrefix: string): boolean {
  return (
    (path.startsWith(runtimeRoot) && !path.startsWith(quarantinedPrefix)) ||
    path.startsWith(testsRoot)
  );
}

function addAncestryViolation(
  violations: BoundaryViolation[],
  root: string,
  ancestor: string,
  descendant: string,
  detail: string,
): void {
  if (!gitSucceeds(root, ["merge-base", "--is-ancestor", ancestor, descendant])) {
    violations.push({ code: "invalid_baseline_ancestry", detail });
  }
}

function verifyHistory(
  root: string,
  _manifest: ProtectedBaselineManifest,
  violations: BoundaryViolation[],
): void {
  addAncestryViolation(
    violations,
    root,
    EXPECTED_AUTHORITY.baselineCommit,
    "HEAD",
    "baseline commit is not an ancestor of the checkout",
  );
  addAncestryViolation(
    violations,
    root,
    EXPECTED_AUTHORITY.stableBranchCommit,
    EXPECTED_AUTHORITY.baselineCommit,
    "baseline commit is not descended from the stable branch commit",
  );
  addAncestryViolation(
    violations,
    root,
    EXPECTED_AUTHORITY.firstGameIrBoundaryCommit,
    EXPECTED_AUTHORITY.firstGameIrProductionCommit,
    "first Game IR production commit is not descended from the boundary commit",
  );
  addAncestryViolation(
    violations,
    root,
    EXPECTED_AUTHORITY.firstGameIrProductionCommit,
    EXPECTED_AUTHORITY.sourceCommit,
    "source commit is not descended from the first Game IR production commit",
  );

  try {
    const parents = git(root, [
      "rev-list",
      "--parents",
      "-n",
      "1",
      EXPECTED_AUTHORITY.firstGameIrBoundaryCommit,
    ]).split(/\s+/);
    if (
      parents.length !== 2 ||
      parents[1] !== EXPECTED_AUTHORITY.baselineCommit
    ) {
      violations.push({
        code: "invalid_baseline_ancestry",
        detail: "first Game IR boundary commit must have exactly one baseline parent",
      });
    }
  } catch {
    violations.push({
      code: "invalid_baseline_ancestry",
      detail: "first Game IR boundary commit is not available",
    });
  }

  try {
    const productionPaths = git(root, [
      "diff-tree",
      "--no-commit-id",
      "--name-only",
      "--diff-filter=A",
      "-r",
      EXPECTED_AUTHORITY.firstGameIrProductionCommit,
    ])
      .split("\n")
      .filter(Boolean);
    if (
      !productionPaths.some(
        (path) =>
          path.startsWith(EXPECTED_AUTHORITY.quarantinedPrefix) &&
          /\.tsx?$/.test(path) &&
          !/\.test\.tsx?$/.test(path),
      )
    ) {
      violations.push({
        code: "invalid_baseline_ancestry",
        detail: "first Game IR production commit does not add Game IR production source",
      });
    }
  } catch {
    violations.push({
      code: "invalid_baseline_ancestry",
      detail: "first Game IR production commit is not available",
    });
  }
}

function verifyProtectedPaths(
  root: string,
  manifest: ProtectedBaselineManifest,
  baselinePaths: Map<string, string>,
  currentPaths: Set<string>,
  violations: BoundaryViolation[],
): void {
  const manifestPaths = new Map(
    manifest.protectedPaths.map(({ path, blobId }) => [path, blobId]),
  );
  const baselineOrder = [...baselinePaths.keys()].sort((a, b) =>
    Buffer.from(a).compare(Buffer.from(b)),
  );
  const manifestOrder = manifest.protectedPaths.map(({ path }) => path);
  if (
    baselineOrder.length !== manifestOrder.length ||
    baselineOrder.some((path, index) => path !== manifestOrder[index])
  ) {
    violations.push({
      code: "baseline_manifest_mismatch",
      detail: "manifest protected paths must equal the sorted baseline tree exactly",
    });
  }
  const allPaths = new Set([
    ...baselinePaths.keys(),
    ...manifestPaths.keys(),
  ]);
  const currentBlobs = workingTreeBlobs(root, [...baselinePaths.keys()]);
  for (const path of [...allPaths].sort((a, b) =>
    Buffer.from(a).compare(Buffer.from(b)),
  )) {
    const baselineBlob = baselinePaths.get(path);
    const manifestBlob = manifestPaths.get(path);
    if (baselineBlob === undefined || manifestBlob === undefined || baselineBlob !== manifestBlob) {
      violations.push({
        code: "baseline_manifest_mismatch",
        path,
        detail: "manifest protected path/blob set does not exactly match baseline tree",
      });
    }
    if (baselineBlob === undefined) continue;
    if (!currentPaths.has(path)) {
      violations.push({ code: "missing_protected_path", path });
      continue;
    }
    try {
      const currentBlob = currentBlobs.get(path);
      if (currentBlob === undefined) throw new Error("protected path is unreadable");
      const correction = EXPECTED_TEST_CORRECTIONS.find(({ path: correctionPath }) => correctionPath === path);
      const expectedCurrentBlob = correction?.correctedBlobId ?? baselineBlob;
      if (currentBlob !== expectedCurrentBlob) {
        violations.push({ code: "protected_blob_mismatch", path });
      }
    } catch {
      violations.push({ code: "missing_protected_path", path });
    }
    if (/\.tsx?$/.test(path)) {
      try {
        if (gameIrReference.test(readFileSync(join(root, path), "utf8"))) {
          violations.push({
            code: "game_ir_reference_in_protected_source",
            path,
          });
        }
      } catch {
        // The blob check above already reports a missing/unreadable source.
      }
    }
  }

  for (const path of currentPaths) {
    if (isProtectedPath(path, EXPECTED_AUTHORITY.quarantinedPrefix) && !baselinePaths.has(path)) {
      violations.push({ code: "unexpected_protected_path", path });
    }
  }
}

export function verifyGameIrIsolationBoundary(
  root: string,
  manifest: ProtectedBaselineManifest,
): BoundaryReport {
  const violations: BoundaryViolation[] = [];
  const manifestViolations = validateManifest(root, manifest);
  if (manifestViolations.length > 0) return { violations: manifestViolations };
  verifyHistory(root, manifest, violations);
  const currentPaths = new Set(trackedPaths(root));
  for (const path of currentPaths) {
    if (path.startsWith(EXPECTED_AUTHORITY.quarantinedPrefix)) {
      violations.push({ code: "game_ir_source_present", path });
    }
  }
  const baselinePaths = treeEntries(root, EXPECTED_AUTHORITY.baselineCommit, [runtimeRoot, testsRoot]);
  for (const path of [...baselinePaths.keys()]) {
    if (path.startsWith(EXPECTED_AUTHORITY.quarantinedPrefix)) baselinePaths.delete(path);
  }
  verifyProtectedPaths(root, manifest, baselinePaths, currentPaths, violations);
  compareManifestList(
    sortedDiffPaths(root, manifest),
    manifest.changedOutsideQuarantine,
    violations,
    "changedOutsideQuarantine",
  );
  compareManifestList(
    sortedScratchDiffPaths(root, manifest),
    manifest.trackedScratchPaths,
    violations,
    "trackedScratchPaths",
  );

  const baselineScratch = new Set(
    treeEntries(root, EXPECTED_AUTHORITY.baselineCommit, [".superpowers/sdd/"]).keys(),
  );
  const currentTrackedPaths = new Set(stagedTrackedPaths(root));
  for (const path of currentTrackedPaths) {
    if (path.startsWith(".superpowers/sdd/") && !baselineScratch.has(path)) {
      violations.push({ code: "tracked_sdd_scratch", path });
    }
  }
  return { violations };
}

if (import.meta.main) {
  const manifestPath = join(
    process.cwd(),
    "docs/superpowers/evidence/2026-09-03-game-ir-protected-baseline.json",
  );
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ProtectedBaselineManifest;
  const report = verifyGameIrIsolationBoundary(process.cwd(), manifest);
  if (report.violations.length > 0) {
    for (const violation of report.violations) {
      const location = violation.path ? ` ${violation.path}` : "";
      console.error(`${violation.code}${location}`);
    }
    process.exitCode = 1;
  } else {
    console.log("game-ir isolation boundary: PASS");
  }
}
