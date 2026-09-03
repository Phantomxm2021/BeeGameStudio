import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type ProtectedBaselineManifest = Readonly<{
  schemaVersion: "game-ir-protected-baseline.v1";
  baselineCommit: "d821e286ebf7eb3ad1b4725ae60dac7a9fef95b6";
  stableBranchCommit: "70df2e2c79bd214862af3959a257c5f5f42bd666";
  firstGameIrBoundaryCommit: "109e7195d314bb716922ef2dd2de65567e428d64";
  firstGameIrProductionCommit: "f4a7d16f7bde3bb8a978f1a10350ad2cef84aa8f";
  sourceCommit: "4335363b2cd33d1f0b7bd807bff95d9389c67ce1";
  quarantinedPrefix: "packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/";
  protectedPaths: readonly Readonly<{ path: string; blobId: string }>[];
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

function sortedDiffPaths(root: string, manifest: ProtectedBaselineManifest): string[] {
  return git(root, [
    "diff",
    "--name-only",
    manifest.baselineCommit,
    manifest.sourceCommit,
  ])
    .split("\n")
    .filter(Boolean)
    .filter((path) => isProtectedPath(path, manifest.quarantinedPrefix))
    .sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));
}

function sortedScratchDiffPaths(
  root: string,
  manifest: ProtectedBaselineManifest,
): string[] {
  return git(root, [
    "diff",
    "--name-only",
    manifest.baselineCommit,
    manifest.sourceCommit,
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
  manifest: ProtectedBaselineManifest,
  violations: BoundaryViolation[],
): void {
  addAncestryViolation(
    violations,
    root,
    manifest.baselineCommit,
    "HEAD",
    "baseline commit is not an ancestor of the checkout",
  );
  addAncestryViolation(
    violations,
    root,
    manifest.stableBranchCommit,
    manifest.baselineCommit,
    "baseline commit is not descended from the stable branch commit",
  );
  addAncestryViolation(
    violations,
    root,
    manifest.firstGameIrBoundaryCommit,
    manifest.firstGameIrProductionCommit,
    "first Game IR production commit is not descended from the boundary commit",
  );
  addAncestryViolation(
    violations,
    root,
    manifest.firstGameIrProductionCommit,
    manifest.sourceCommit,
    "source commit is not descended from the first Game IR production commit",
  );

  try {
    const parents = git(root, [
      "rev-list",
      "--parents",
      "-n",
      "1",
      manifest.firstGameIrBoundaryCommit,
    ]).split(/\s+/);
    if (
      parents.length !== 2 ||
      parents[1] !== manifest.baselineCommit
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
      manifest.firstGameIrProductionCommit,
    ])
      .split("\n")
      .filter(Boolean);
    if (
      !productionPaths.some(
        (path) =>
          path.startsWith(manifest.quarantinedPrefix) &&
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
      const currentBlob = git(root, ["hash-object", "--no-filters", "--", path]);
      if (currentBlob !== baselineBlob) {
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
    if (isProtectedPath(path, manifest.quarantinedPrefix) && !baselinePaths.has(path)) {
      violations.push({ code: "unexpected_protected_path", path });
    }
  }
}

export function verifyGameIrIsolationBoundary(
  root: string,
  manifest: ProtectedBaselineManifest,
): BoundaryReport {
  const violations: BoundaryViolation[] = [];
  verifyHistory(root, manifest, violations);
  const currentPaths = new Set(trackedPaths(root));
  const baselinePaths = treeEntries(root, manifest.baselineCommit, [runtimeRoot, testsRoot]);
  for (const path of [...baselinePaths.keys()]) {
    if (path.startsWith(manifest.quarantinedPrefix)) baselinePaths.delete(path);
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
    treeEntries(root, manifest.baselineCommit, [".superpowers/sdd/"]).keys(),
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
