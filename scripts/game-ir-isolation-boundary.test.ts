import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { type ProtectedBaselineManifest, verifyGameIrIsolationBoundary } from "./game-ir-isolation-boundary";

const protectedSource = "packages/agent-workflow-server/src/beegame/complete-game-document.ts";
const protectedTest = "packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts";
const quarantine = "packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/";
const roots: string[] = [];
let sharedRoot: string | undefined;
let sharedManifest: ProtectedBaselineManifest | undefined;
setDefaultTimeout(30_000);

function git(root: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "boundary-test", GIT_AUTHOR_EMAIL: "boundary-test@example.test", GIT_COMMITTER_NAME: "boundary-test", GIT_COMMITTER_EMAIL: "boundary-test@example.test" },
  }).trim();
}

function setupRepository() {
  if (sharedRoot && sharedManifest) {
    if (git(sharedRoot, ["rev-parse", "HEAD"]) !== sharedManifest.sourceCommit) git(sharedRoot, ["checkout", "--quiet", "--detach", sharedManifest.sourceCommit]);
    restoreCleanCheckout(sharedRoot, sharedManifest);
    const removedPaths = ["packages/agent-workflow-server/src/beegame/added.ts", ".superpowers/sdd/task-report.md", ".superpowers/sdd/unlisted.md", ...sharedManifest.trackedScratchPaths];
    for (const path of removedPaths) {
      if (existsSync(join(sharedRoot, path))) rmSync(join(sharedRoot, path));
    }
    git(sharedRoot, ["update-index", "--force-remove", "--", ...removedPaths]);
    for (const path of [protectedSource, protectedTest]) {
      writeFileSync(join(sharedRoot, path), execFileSync("git", ["show", `${sharedManifest.baselineCommit}:${path}`], { cwd: sharedRoot }));
    }
    git(sharedRoot, ["update-index", "--add", "--", protectedSource, protectedTest]);
    return { root: sharedRoot, manifest: JSON.parse(JSON.stringify(sharedManifest)), protectedSource, unrelatedCommit: "", testOnlyProductionCommit: "" } as {
      root: string;
      manifest: ProtectedBaselineManifest;
      protectedSource: string;
      unrelatedCommit: string;
      testOnlyProductionCommit: string;
    };
  }
  const root = mkdtempSync(join(tmpdir(), "game-ir-boundary-"));
  roots.push(root);
  git(root, ["init", "--quiet", "-b", "main"]);
  const sourceObjects = git(process.cwd(), ["rev-parse", "--path-format=absolute", "--git-path", "objects"]);
  mkdirSync(join(root, ".git/objects/info"), { recursive: true });
  writeFileSync(join(root, ".git/objects/info/alternates"), `${sourceObjects}\n`);
  writeFileSync(join(root, ".git/info/sparse-checkout"), "/packages/agent-workflow-server/src/beegame/**\n/packages/agent-workflow-server/src/__tests__/**\n/.superpowers/sdd/**\n");
  git(root, ["config", "core.sparseCheckout", "true"]);
  git(root, ["checkout", "--quiet", "4335363b2cd33d1f0b7bd807bff95d9389c67ce1"]);
  git(root, ["config", "user.name", "boundary-test"]);
  git(root, ["config", "user.email", "boundary-test@example.test"]);
  const manifest = JSON.parse(readFileSync(join(process.cwd(), "docs/superpowers/evidence/2026-09-03-game-ir-protected-baseline.json"), "utf8")) as ProtectedBaselineManifest;
  restoreCleanCheckout(root, manifest);
  sharedRoot = root;
  sharedManifest = manifest;
  return { root, manifest: JSON.parse(JSON.stringify(manifest)), protectedSource, unrelatedCommit: "", testOnlyProductionCommit: "" } as {
    root: string;
    manifest: ProtectedBaselineManifest;
    protectedSource: string;
    unrelatedCommit: string;
    testOnlyProductionCommit: string;
  };
}

function restoreCleanCheckout(root: string, manifest: ProtectedBaselineManifest): void {
  const baselinePaths = new Set(manifest.protectedPaths.map(({ path }) => path));
  const currentPaths = git(root, ["ls-files", "-z"]).split("\0").filter(Boolean);
  for (const path of currentPaths) {
    if ((path.startsWith("packages/agent-workflow-server/src/beegame/") || path.startsWith("packages/agent-workflow-server/src/__tests__/")) && !baselinePaths.has(path)) {
      rmSync(join(root, path));
      git(root, ["update-index", "--force-remove", "--", path]);
    }
  }
  for (const { path } of manifest.protectedPaths) writeFileSync(join(root, path), execFileSync("git", ["show", `${manifest.baselineCommit}:${path}`], { cwd: root }));
  const baselineScratch = new Set(git(root, ["ls-tree", "-r", "--name-only", manifest.baselineCommit, "--", ".superpowers/sdd/"]).split("\n").filter(Boolean));
  for (const path of git(root, ["ls-files", "--cached", "-z"]).split("\0").filter(Boolean)) if (path.startsWith(".superpowers/sdd/") && !baselineScratch.has(path)) {
    rmSync(join(root, path));
    git(root, ["update-index", "--force-remove", "--", path]);
  }
}

function codes(root: string, manifest: ProtectedBaselineManifest): string[] {
  return verifyGameIrIsolationBoundary(root, manifest).violations.map((violation) => violation.code);
}

afterAll(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("verifyGameIrIsolationBoundary", () => {
  test("allows unchanged protected files and Game IR-only changes", () => {
    const { root, manifest } = setupRepository();
    expect(verifyGameIrIsolationBoundary(root, manifest).violations).toEqual([]);
  });
  test("reports a tracked TypeScript file reintroduced under the old Game IR prefix", () => {
    const fixture = setupRepository();
    const reintroducedPath = join(fixture.root, `${quarantine}reintroduced.ts`);
    writeFileSync(reintroducedPath, "export const reintroduced = true;\n");
    git(fixture.root, ["add", reintroducedPath]);

    expect(codes(fixture.root, fixture.manifest)).toContain("game_ir_source_present");
  });
  test("reports an untracked test file reintroduced under the old Game IR prefix", () => {
    const fixture = setupRepository();
    const reintroducedPath = join(fixture.root, `${quarantine}reintroduced.test.ts`);
    writeFileSync(reintroducedPath, "test('reintroduced', () => {});\n");

    expect(codes(fixture.root, fixture.manifest)).toContain("game_ir_source_present");
  });
  test("reports an untracked arbitrary file reintroduced under the old Game IR prefix", () => {
    const fixture = setupRepository();
    const reintroducedPath = join(fixture.root, `${quarantine}reintroduced`);
    writeFileSync(reintroducedPath, "reintroduced\n");

    expect(codes(fixture.root, fixture.manifest)).toContain("game_ir_source_present");
  });
  test("reports a modified protected blob", () => {
    const fixture = setupRepository();
    writeFileSync(join(fixture.root, fixture.protectedSource), "export const value = 'changed';\n");
    expect(codes(fixture.root, fixture.manifest)).toContain("protected_blob_mismatch");
  });
  test("reports an added protected path", () => {
    const fixture = setupRepository();
    const addedPath = join(fixture.root, "packages/agent-workflow-server/src/beegame/added.ts");
    writeFileSync(addedPath, "export const added = true;\n");
    git(fixture.root, ["add", addedPath]);
    expect(codes(fixture.root, fixture.manifest)).toContain("unexpected_protected_path");
  });
  test("reports a deleted protected path", () => {
    const fixture = setupRepository();
    rmSync(join(fixture.root, fixture.protectedSource));
    git(fixture.root, ["update-index", "--force-remove", "--", fixture.protectedSource]);
    expect(codes(fixture.root, fixture.manifest)).toContain("missing_protected_path");
  });
  test("rejects a protected path omitted from the manifest even when it is deleted", () => {
    const fixture = setupRepository();
    rmSync(join(fixture.root, fixture.protectedSource));
    git(fixture.root, ["update-index", "--force-remove", "--", fixture.protectedSource]);
    fixture.manifest = {
      ...fixture.manifest,
      protectedPaths: fixture.manifest.protectedPaths.filter(
        ({ path }) => path !== fixture.protectedSource,
      ),
    } as ProtectedBaselineManifest;

    expect(codes(fixture.root, fixture.manifest)).toContain("baseline_manifest_mismatch");
  });
  test("rejects changed and scratch allowlists that do not match the Git range", () => {
    const fixture = setupRepository();
    fixture.manifest = {
      ...fixture.manifest,
      changedOutsideQuarantine: [],
      trackedScratchPaths: [],
    } as ProtectedBaselineManifest;

    expect(codes(fixture.root, fixture.manifest)).toContain("baseline_manifest_mismatch");
  });
  test("rejects changed and scratch allowlists with paths added beyond the Git range", () => {
    const fixture = setupRepository();
    fixture.manifest = {
      ...fixture.manifest,
      changedOutsideQuarantine: [...fixture.manifest.changedOutsideQuarantine, "packages/agent-workflow-server/src/beegame/extra.ts"],
      trackedScratchPaths: [...fixture.manifest.trackedScratchPaths, ".superpowers/sdd/extra.md"],
    } as ProtectedBaselineManifest;

    expect(codes(fixture.root, fixture.manifest)).toContain("baseline_manifest_mismatch");
  });
  test("rejects Game IR references in protected TypeScript source", () => {
    const fixture = setupRepository();
    writeFileSync(join(fixture.root, fixture.protectedSource), "import { boundary } from './game-ir/boundary';\nexport { boundary };\n");
    expect(codes(fixture.root, fixture.manifest)).toContain("game_ir_reference_in_protected_source");
  });
  test("rejects tracked SDD scratch paths", () => {
    const fixture = setupRepository();
    const scratch = ".superpowers/sdd/task-report.md";
    mkdirSync(join(fixture.root, ".superpowers/sdd"), { recursive: true });
    writeFileSync(join(fixture.root, scratch), "scratch\n");
    git(fixture.root, ["add", scratch]);
    fixture.manifest = { ...fixture.manifest, trackedScratchPaths: [scratch] } as ProtectedBaselineManifest;
    expect(codes(fixture.root, fixture.manifest)).toContain("tracked_sdd_scratch");
  });
  test("rejects a newly tracked SDD scratch path omitted from the manifest", () => {
    const fixture = setupRepository();
    const scratch = ".superpowers/sdd/unlisted.md";
    writeFileSync(join(fixture.root, scratch), "scratch\n");
    git(fixture.root, ["add", scratch]);

    expect(codes(fixture.root, fixture.manifest)).toContain("tracked_sdd_scratch");
  });
  test("allows a scratch path already tracked by the baseline", () => {
    const fixture = setupRepository();

    expect(codes(fixture.root, fixture.manifest)).not.toContain("tracked_sdd_scratch");
  });
  test("rejects a baseline that is not an ancestor of the checkout", () => {
    const fixture = setupRepository();
    const unrelatedCommit = git(fixture.root, ["commit-tree", git(fixture.root, ["write-tree"]), "-m", "unrelated"]);
    git(fixture.root, ["checkout", "--quiet", "--detach", unrelatedCommit]);
    expect(codes(fixture.root, fixture.manifest)).toContain("invalid_baseline_ancestry");
  });
  test("requires the first production commit to add a non-test TypeScript source", () => {
    const fixture = setupRepository();
    fixture.manifest = {
      ...fixture.manifest,
      firstGameIrProductionCommit: fixture.manifest.baselineCommit,
    } as ProtectedBaselineManifest;

    expect(codes(fixture.root, fixture.manifest)).toContain("baseline_manifest_mismatch");
  });
  test("rejects a coordinated baseline, source, and quarantine replacement", () => {
    const fixture = setupRepository();
    fixture.manifest = {
      ...fixture.manifest,
      baselineCommit: fixture.manifest.sourceCommit,
      sourceCommit: fixture.manifest.baselineCommit,
      quarantinedPrefix: "packages/agent-workflow-server/src/other/",
    } as ProtectedBaselineManifest;

    expect(codes(fixture.root, fixture.manifest)).toContain("baseline_manifest_mismatch");
  });
  test("reports unknown manifest keys without throwing", () => {
    const fixture = setupRepository();
    const malformed = { ...fixture.manifest, unknown: true };

    expect(() => codes(fixture.root, malformed as ProtectedBaselineManifest)).not.toThrow();
    expect(codes(fixture.root, malformed as ProtectedBaselineManifest)).toContain("baseline_manifest_mismatch");
  });
  test("reports unknown nested manifest keys without throwing", () => {
    const fixture = setupRepository();
    const malformed = {
      ...fixture.manifest,
      protectedPaths: fixture.manifest.protectedPaths.map((entry, index) =>
        index === 0 ? { ...entry, unknown: true } : entry,
      ),
    };

    expect(() => codes(fixture.root, malformed as ProtectedBaselineManifest)).not.toThrow();
    expect(codes(fixture.root, malformed as ProtectedBaselineManifest)).toContain("baseline_manifest_mismatch");
  });
  test("reports missing manifest keys without throwing", () => {
    const fixture = setupRepository();
    const { schemaVersion: _schemaVersion, ...malformed } = fixture.manifest;

    expect(() => codes(fixture.root, malformed as ProtectedBaselineManifest)).not.toThrow();
    expect(codes(fixture.root, malformed as ProtectedBaselineManifest)).toContain("baseline_manifest_mismatch");
  });
  test("reports non-array manifest fields without throwing", () => {
    const fixture = setupRepository();
    const malformed = { ...fixture.manifest, protectedPaths: {} };

    expect(() => codes(fixture.root, malformed as ProtectedBaselineManifest)).not.toThrow();
    expect(codes(fixture.root, malformed as ProtectedBaselineManifest)).toContain("baseline_manifest_mismatch");
  });
  test("rejects historical evidence with a missing entry or changed commit", () => {
    const fixture = setupRepository();
    const malformed = {
      ...fixture.manifest,
      historicalEvidence: fixture.manifest.historicalEvidence.slice(0, 1).map((evidence) => ({
        ...evidence,
        commit: fixture.manifest.baselineCommit,
      })),
    };

    expect(codes(fixture.root, malformed as ProtectedBaselineManifest)).toContain("baseline_manifest_mismatch");
  });
  test("reports unknown historical evidence keys without throwing", () => {
    const fixture = setupRepository();
    const malformed = {
      ...fixture.manifest,
      historicalEvidence: fixture.manifest.historicalEvidence.map((entry, index) =>
        index === 0 ? { ...entry, unknown: true } : entry,
      ),
    };

    expect(() => codes(fixture.root, malformed as ProtectedBaselineManifest)).not.toThrow();
    expect(codes(fixture.root, malformed as ProtectedBaselineManifest)).toContain("baseline_manifest_mismatch");
  });
  test("uses the current checkout content when a protected file is staged", () => {
    const fixture = setupRepository();
    writeFileSync(join(fixture.root, fixture.protectedSource), "export const value = 'staged';\n");
    git(fixture.root, ["add", fixture.protectedSource]);
    expect(readFileSync(join(fixture.root, fixture.protectedSource), "utf8")).toContain("staged");
    expect(codes(fixture.root, fixture.manifest)).toContain("protected_blob_mismatch");
  });
});
