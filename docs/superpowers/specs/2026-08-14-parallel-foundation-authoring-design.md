# Parallel Foundation Document Authoring

## Goal

After the GDD is committed, complete the remaining seven foundation documents in 35–50 minutes under normal provider conditions without reducing their existing contracts, production materials, or mechanical quality gates.

The design optimizes wall-clock time. A 10–20% increase in aggregate token usage is acceptable. Document completeness and the Bee Game Studio boundary are not negotiable.

## Boundary

Bee Game Studio may:

- resolve the existing document dependency graph;
- start, pause, resume, and observe native document-author sessions;
- provide each session with its target path, document contract, confirmed brief, and authorized upstream projections;
- record draft/final lifecycle state;
- run deterministic validation and commit a document after the native author finishes it.

Bee Game Studio may not:

- write or rewrite document prose;
- choose section content or split prose into checkpoints;
- assemble text produced by multiple authors into one document;
- summarize missing upstream documents on the author's behalf;
- modify the native agent core, file tools, context compression, or streaming transport.

Each document has exactly one native author session and one canonical file path. There is no alternate renderer, structured-document payload, or second document track.

## Authoring Lifecycle

### 1. Parallel complete drafts

Once `docs/GDD.md` is committed, start all seven remaining native document-author sessions concurrently. Each session receives:

- the confirmed product brief;
- the committed GDD sections already authorized by its existing contract;
- its complete section and production-material contract;
- the canonical target path;
- a declaration that unavailable downstream authorities will arrive during calibration.

Every author writes a complete document, not a skeleton. Missing downstream authority must be handled as an explicit authored assumption or owned decision within the document's existing risk/dependency sections. Placeholder prose, empty sections, and reduced production materials remain invalid.

The draft is written directly to the canonical target path but does not receive a committed document receipt. It is the first state of the same document, not a parallel artifact.

### 2. Dependency calibration

After drafts exist, resume the same native sessions in the existing dependency order:

1. `LEVEL_SCENE_DESIGN` calibrates against the committed GDD and becomes final.
2. `BALANCE_DESIGN`, `ART_DIRECTION`, and `UI_UX_SPEC` calibrate concurrently against GDD plus finalized Level authority.
3. `TECHNICAL_DESIGN` and `AUDIO_DESIGN` calibrate concurrently against their now-final upstream projections.
4. `ASSET_PLAN` calibrates against all finalized upstream projections.

For calibration, Bee Game Studio sends only the contract-selected upstream sections and their digests. The native author reads its own canonical file and edits only statements affected by changed or newly available authority. Bee Game Studio does not construct edits or specify write sizes.

### 3. Finalization

After a native author reports calibration complete:

- run the existing complete-document validator;
- commit the existing canonical file through the existing authored-document receipt path;
- expose the committed projection to downstream calibration;
- do not ask the native author to run a redundant full-file grep or byte-count check.

A validation failure is returned to the same native session as a concrete mechanical error. It is not an API retry and does not restart the document from scratch. Provider errors, transport failures, and permission failures remain visible and pause the affected document instead of silently retrying.

## Scheduling and Isolation

- Initial draft concurrency is seven because every author owns a distinct file.
- Calibration concurrency follows the four dependency waves above.
- A failure in one document does not cancel independent authors.
- A downstream calibration waits for all upstream documents selected by its existing contract.
- The workflow does not mark the foundation stage complete until all seven documents have committed receipts and the existing eight-document readiness audit passes.

## Observability

For every document, record separately:

- draft start/end and calibration start/end;
- native turns and tool calls;
- fresh input, cache-read input, and output tokens;
- provider/API duration and wall-clock duration;
- longest raw-event silence;
- final bytes, lines, digest, validation result, and receipt status.

The UI stage timer remains one non-overlapping wall-clock interval. Parallel document durations must not be added together and displayed as stage elapsed time.

## Acceptance

Use the Web React flow in Chrome with fixed service ports. Create a new test project and allow the complete eight-document foundation stage to finish.

The change is accepted only when:

- all eight documents exist at their canonical paths;
- all complete-document validators and the eight-document readiness audit pass;
- every non-GDD document was authored by one native session and finalized through calibration, with no BGS-authored prose;
- no document is restarted from scratch after a calibration or validation error;
- wall-clock time from GDD commit to the seventh downstream commit is normally 35–50 minutes and does not exceed 60 minutes in the acceptance run;
- aggregate token usage and per-document token breakdown are reported rather than hidden behind one total;
- generated documents are manually sampled for discipline responsibility, implementation usability, redundancy, and human readability.

## Expected Trade-offs

- Aggregate tokens may rise by 10–20% because seven native sessions draft concurrently and later receive narrow calibration context.
- Provider-side concurrency may create longer SSE silences. These must be observed, not masked by BGS retries or watchdog-generated work.
- The approach reduces elapsed time without reducing document scope. It does not promise lower token cost.
