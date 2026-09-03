import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { type ProtectedBaselineManifest, verifyGameIrIsolationBoundary } from "./game-ir-isolation-boundary";

const protectedSource = "packages/agent-workflow-server/src/beegame/protected.ts";
const protectedTest = "packages/agent-workflow-server/src/__tests__/protected.test.ts";
const quarantine = "packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/";
const baselineScratch = ".superpowers/sdd/old-report.md";
const rangeScratch = ".superpowers/sdd/new-report.md";
const roots: string[] = [];

function git(root: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "boundary-test", GIT_AUTHOR_EMAIL: "boundary-test@example.test", GIT_COMMITTER_NAME: "boundary-test", GIT_COMMITTER_EMAIL: "boundary-test@example.test" },
  }).trim();
}

function commit(root: string, message: string): string {
  git(root, ["add", "--all"]);
  git(root, ["commit", "--quiet", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]);
}

function setupRepository() {
  const root = mkdtempSync(join(tmpdir(), "game-ir-boundary-"));
  roots.push(root);
  git(root, ["init", "--quiet", "-b", "main"]);
  git(root, ["config", "user.name", "boundary-test"]);
  git(root, ["config", "user.email", "boundary-test@example.test"]);
  writeFileSync(join(root, "README.md"), "stable\n");
  const stableBranchCommit = commit(root, "stable branch");
  mkdirSync(join(root, protectedSource, ".."), { recursive: true });
  mkdirSync(join(root, protectedTest, ".."), { recursive: true });
  writeFileSync(join(root, protectedSource), "export const value = 'baseline';\n");
  writeFileSync(join(root, protectedTest), "export const testValue = true;\n");
  mkdirSync(join(root, ".superpowers/sdd"), { recursive: true });
  writeFileSync(join(root, baselineScratch), "old scratch\n");
  const baselineCommit = commit(root, "baseline");
  mkdirSync(join(root, quarantine), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, `${quarantine}boundary.ts`), "export const boundary = true;\n");
  writeFileSync(join(root, "docs/game-ir-boundary.md"), "Game IR only\n");
  const firstGameIrBoundaryCommit = commit(root, "game ir boundary");
  writeFileSync(join(root, `${quarantine}production.ts`), "export const production = true;\n");
  const firstGameIrProductionCommit = commit(root, "game ir production");
  writeFileSync(join(root, `${quarantine}only.test.ts`), "export const onlyTest = true;\n");
  const testOnlyProductionCommit = commit(root, "test-only game ir production");
  writeFileSync(join(root, protectedSource), "export const value = 'source change';\n");
  writeFileSync(join(root, rangeScratch), "new scratch\n");
  const sourceCommit = commit(root, "source changes");
  writeFileSync(join(root, protectedSource), "export const value = 'baseline';\n");
  rmSync(join(root, rangeScratch));
  rmSync(join(root, `${quarantine}only.test.ts`));
  commit(root, "clean checkout");
  const protectedPaths = [protectedSource, protectedTest]
    .sort((a, b) => Buffer.from(a).compare(Buffer.from(b)))
    .map((path) => ({ path, blobId: git(root, ["rev-parse", `${baselineCommit}:${path}`]) }));
  const manifest = {
    schemaVersion: "game-ir-protected-baseline.v1", baselineCommit, stableBranchCommit, firstGameIrBoundaryCommit, firstGameIrProductionCommit,
    sourceCommit, quarantinedPrefix: quarantine, protectedPaths,
    changedOutsideQuarantine: [protectedSource], trackedScratchPaths: [rangeScratch], historicalEvidence: [],
    historicalEvidenceGap: "no baseline-bound Revision-to-zero-and-Checklist Chrome receipt found",
  } as unknown as ProtectedBaselineManifest;
  const unrelatedCommit = git(root, ["commit-tree", git(root, ["write-tree"]), "-m", "unrelated"]);
  return { root, manifest, protectedSource, unrelatedCommit, testOnlyProductionCommit };
}

function codes(root: string, manifest: ProtectedBaselineManifest): string[] {
  return verifyGameIrIsolationBoundary(root, manifest).violations.map((violation) => violation.code);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("verifyGameIrIsolationBoundary", () => {
  test("allows unchanged protected files and Game IR-only changes", () => {
    const { root, manifest } = setupRepository();
    expect(verifyGameIrIsolationBoundary(root, manifest).violations).toEqual([]);
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
    git(fixture.root, ["add", "--update"]);
    expect(codes(fixture.root, fixture.manifest)).toContain("missing_protected_path");
  });
  test("rejects a protected path omitted from the manifest even when it is deleted", () => {
    const fixture = setupRepository();
    rmSync(join(fixture.root, fixture.protectedSource));
    git(fixture.root, ["add", "--update"]);
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
    fixture.manifest = { ...fixture.manifest, baselineCommit: fixture.unrelatedCommit } as ProtectedBaselineManifest;
    expect(codes(fixture.root, fixture.manifest)).toContain("invalid_baseline_ancestry");
  });
  test("requires the first production commit to add a non-test TypeScript source", () => {
    const fixture = setupRepository();
    fixture.manifest = {
      ...fixture.manifest,
      firstGameIrProductionCommit: fixture.testOnlyProductionCommit,
    } as ProtectedBaselineManifest;

    expect(codes(fixture.root, fixture.manifest)).toContain("invalid_baseline_ancestry");
  });
  test("uses the current checkout content when a protected file is staged", () => {
    const fixture = setupRepository();
    writeFileSync(join(fixture.root, fixture.protectedSource), "export const value = 'staged';\n");
    git(fixture.root, ["add", fixture.protectedSource]);
    expect(readFileSync(join(fixture.root, fixture.protectedSource), "utf8")).toContain("staged");
    expect(codes(fixture.root, fixture.manifest)).toContain("protected_blob_mismatch");
  });
});
