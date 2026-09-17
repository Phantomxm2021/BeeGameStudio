# Resource delivery repair and acceptance

## Evidence and corrections

The observed dispatch took 144m45s. Its 39 approval request durations sum to
38m18s (overlap must be measured before treating this as wall-clock savings).
Its verification subagent took 52m12s, including approvals. API duration is
cumulative and overlaps tool/subagent execution; these numbers are not additive.
The seven capabilities errors had been repaired before the terminal result.
The remaining schema errors concern selection_reason and audio sidecars.
An audio file with JSON metadata is not a provisional synthesized-audio definition.
IR structure/publication checks are not evidence of complete semantic fidelity.

After repairing selection_reason in a disposable copy, the host exposes another
real discrepancy: sfx_sprite_main is delivered as audio-bank with no capabilities,
while IR coverage requires audio-clip with audio-variants. Do not silently change
IR or relabel the resource to pass. Reconcile the intended delivery with the
source audio specification before repairing this artifact.

Source comparison completed: AUDIO_DESIGN.md:102 explicitly requests 1–2 audio
sprites, and ASSET_PLAN.md:67 defines sfx_sprite_main as a collection with a JSON
slice table. The audio-clip-only IR coverage is therefore a semantic translation
error, not evidence that the delivered audio bank must be split into new files.
Correct this through the existing IR publication path, preserving the source
requirement, and report the delivered variants accurately in resource metadata.
Do not edit committed IR bytes in place or bypass its revision identity.

## Implementation

1. Publish the concrete resource field types and a read-only validation command.
   Reuse the host parser, file/hash audit, IR comparison and readiness functions.
   Do not create another validator or require a verification agent.
2. Accept encoded audio with JSON sidecars. Retain the existing constraints for
   JSON-only provisional audio definitions. Reject non-audio, non-JSON members.
3. Let the resource stage own artifact acceptance. A completed agent turn with
   malformed or missing artifacts reaches needs_action with current diagnostics;
   it must not throw a transport failure before the stage handles the result.
4. On explicit resume, recompute current errors and preserve existing assets.
   Do not inject stale blockedReason strings as current errors or add auto loops.
5. Treat Agent summaries as self-reports. Only accepted host evidence can move
   RESOURCE_PREPARATION to GAME_CONTENT. Keep existing stage boundaries.

## Quantified acceptance

- Current IR publication and source digests pass read-only validation; semantic
  completeness remains pending independent content/runtime acceptance.
- Validator detects wrong selection_reason type, missing/corrupt files, hashes,
  IR drift and incomplete bindings; encoded audio plus JSON is accepted.
- Malformed Manifest reaches needs_action, produces zero accepted receipts and
  launches zero content workers. A corrected delivery advances exactly once.
- Check the existing 45 requirements/72 files in a temporary copy; preserve all
  runtime bytes and IR digests, correct metadata only when demonstrated necessary.
- Record validator elapsed milliseconds; target <2 seconds on this project.
- A future live continuation must show zero ordinary repeated approval waits.
  Measure requests, approval interval union, tool failures and subagent duration.
- Report production versus verification time separately, without summing nested
  intervals. No wall-clock cap, token cap, forced tools or forced subagent policy.
- No promised ten-minute total: establish the next comparable run before setting
  a model-generation target. Existing asset creation is not repeated for validation.

## Execution order and remaining acceptance

1. Land and test host fixes and shared diagnostics first. No native agent changes.
2. Reproduce on a temporary project copy without changing runtime bytes; expect
   the audio-bank mismatch to remain rejected after the 45 field-type repairs.
3. Compare the main sound-effects requirement with the source document. Correct
   the erroneous artifact (IR if its requirement is wrong, assets if delivery is
   wrong), not the acceptance rule. Revalidate all 45 bindings before resuming.
4. Continue the existing run explicitly after loading the repaired server;
   verify one accepted receipt and one downstream content dispatch. Record live
   timing and approvals. Until this completes, report the project as not resumed.
5. Check Scene/UI loads the same IR version and actual registered asset files;
   independent visual/audio acceptance remains required, not inferred from PASS.

## Local verification result

36 targeted tests pass, including a temporary-copy reproduction of the real
45-resource delivery. After repairing selection_reason in the copy, the full
host check took 86 ms and correctly rejected the remaining IR coverage mismatch.
The actual project artifacts/state were not modified or resumed. This is a host
repair and diagnostic verification, not a successful live resource acceptance.

## Immutable IR correction (implemented)

- New publications use `revisions/<foundation>/publications/<publication>/`.
  Existing flat publications remain readable and unchanged; there is no migration
  or overwrite of previously accepted artifacts.
- `POST /api/projects/:id/game-ir/revise` accepts `expectedResultDigest` and a
  complete `game-ir-direct-draft.v2` draft through existing project ownership and
  write permission checks. It publishes a separate handle without starting an
  agent. The previous publication remains readable. The expected digest rejects
  stale edits, and workflow mutation uses its existing lock.
- This entry point is deliberately limited to idle RESOURCE_PREPARATION before
  accepted resource delivery. It does not silently invalidate already-built games.
  It binds the workflow to the corrected publication and leaves it needs_action
  for explicit resource continuation; it never manufactures a delivery receipt.
- Current-project disposable-copy acceptance: original legacy publication reads
  successfully; corrected IR models sfx_sprite_main as one audio-bank with
  audio-variants and no independent component coverage. Matching requirement and
  resource metadata plus the 45 selection_reason type repairs yield 45 accepted
  bindings in 56 ms. All declared runtime hashes are unchanged. No model call or
  usage submission was needed. This does not establish visual/audio quality.
- Live deployment/continuation remains pending: the running project API requires
  authentication (unauthenticated request returns 401). No bypass or direct edit
  of its published IR/run state was performed.
