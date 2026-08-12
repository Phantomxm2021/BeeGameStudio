# Eight-document Chrome generation and token audit

Date: 2026-08-12  
Project: `lighthouse-lightpath-restoration--ae061f1fda00`  
Workflow run: `6753957b-644d-4b46-9db2-664086c2a28b`  
Code under test: `14b0c3e7 fix: stream canonical document parts`

## Outcome

Chrome was used to run the real BeeGameStudio workflow. All eight foundation documents and all eight authority sidecars were committed. The workflow was stopped immediately after it entered `DOCUMENT_REVIEW`; implementation did not start and the document reviewer did not complete a review cycle.

The generated set is usable as a production-planning package. It is not a skeleton: it contains gameplay rules, topology, formulas, runtime contracts, visual/UI/audio specifications, asset ownership, budgets, risks, acceptance criteria, diagrams, and production tables. The deterministic foundation-document audit returned `{ valid: true, issues: [] }`.

The generation is nevertheless not token-efficient. The new part protocol fixed full-document truncation, but its current one-part-per-model-turn cadence produces excessive cache-read accounting. Reliability is fixed; token optimization is not finished.

## Fixed test endpoints

- Frontend: `62273`
- Runtime: `62274`
- Billing: `62275`
- Skills: `62276`
- Resources: `62277`

## Durable output evidence

All receipt document and authority digests were recomputed from disk and matched.

| Document | Markdown bytes | Lines | Authority bytes | Authority records | Receipt/digests |
| --- | ---: | ---: | ---: | ---: | --- |
| `GDD.md` | 41,799 | 568 | 13,995 | 29 | committed / match |
| `LEVEL_SCENE_DESIGN.md` | 38,861 | 611 | 13,621 | 26 | committed / match |
| `BALANCE_DESIGN.md` | 45,005 | 669 | 15,496 | 31 | committed / match |
| `TECHNICAL_DESIGN.md` | 51,374 | 905 | 15,787 | 27 | committed / match |
| `ART_DIRECTION.md` | 66,427 | 939 | 15,797 | 32 | committed / match |
| `UI_UX_SPEC.md` | 55,082 | 946 | 12,760 | 24 | committed / match |
| `AUDIO_DESIGN.md` | 45,522 | 759 | 11,485 | 22 | committed / match |
| `ASSET_PLAN.md` | 65,998 | 1,017 | 10,964 | 21 | committed / match |
| **Total** | **410,068** | **6,414** | **109,905** | **212** | **8/8 match** |

The combined Markdown and authority data is 519,973 bytes. The Markdown heading/table audit found no exact duplicated paragraph of at least 100 normalized characters within a document or across documents. This does not mean there is no semantic overlap; it means the output is not dominated by literal copy/paste repetition.

## Quality assessment by responsibility

| Document | Assessment | Main optimization opportunity |
| --- | --- | --- |
| GDD | Strong product and gameplay authority. Clear promise, loops, verbs, rules, states, progression, scope, analytics, risks and acceptance. | Keep as the concise upstream authority; avoid repeating its product premise downstream. |
| Level/Scene | Strong topology, sequence, routes, beats, recovery, camera and scene lifecycle specification. | Some acceptance material can be consolidated into one production matrix. |
| Balance | Strong units, parameters, formulas, bounds, exploit controls and tuning method. | Tables are useful; narrative explanations around them can be shortened. |
| Technical | Strong architecture, data, persistence, input, budgets, security, diagnostics, build and test contracts. | Avoid over-prescribing implementation details that are already encoded in content schemas. |
| Art Direction | Production-usable visual rules, palettes, silhouettes, materials, animation, VFX and asset acceptance. | Heading hierarchy is noisy and the document repeats some readability constraints from GDD/UI. |
| UI/UX | Production-usable journeys, screen inventory, HUD, focus, recovery, accessibility, localization and wireframe materials. | Dense and structurally over-sectioned; consolidate screen-state and acceptance tables. |
| Audio | Production-usable event taxonomy, music states, ambience, feedback, buses, budgets and delivery rules. | Already reasonably bounded; retain reference/license register but trim repeated product context. |
| Asset Plan | Comprehensive BOM, owners, dependencies, licenses, formats, pipeline, milestones and validation. | Longest and most operationally repetitive; merge repeated approval/readiness/final-acceptance material. |

### Human usability

The documents are understandable by a human game-development team and contain enough concrete detail to estimate, assign, implement and accept work. The main human cost is navigation: Art, UI and Asset use many same-level headings, producing a noisy outline. A generated table of contents and normalized heading depth would improve scanability without changing substance.

### Agent usability

The documents are suitable as development inputs for an agent because they expose stable IDs, explicit ownership, bounded rules, units, paths, budgets and acceptance checks. Agents should not ingest all eight Markdown files indiscriminately on every turn. They should receive the owning document plus authority-sidecar projections for dependencies. Loading the entire set repeatedly would recreate the same context-cost problem seen during authoring.

### Standard and completeness

`GDD.md` is a recognizable full GDD rather than a pitch or outline. The other seven documents are discipline-specific production specifications that a multi-disciplinary human team would normally maintain separately. Eight documents are a reasonable organization for a complete game plan. The set should stay at eight; optimization should reduce repeated material inside each responsibility, not merge every discipline into one giant GDD.

### Redundancy and compression potential

- Literal duplication is low: zero exact long-paragraph duplicates in the audit.
- Semantic restatement is moderate, especially product premise, core rules, accessibility, risks, ownership and acceptance language.
- A conservative editing pass can remove about 15–25% from Art/UI/Asset and 10–15% from the other documents without losing production authority.
- That would save output tokens, but it cannot explain or repair the multi-million-token totals. The dominant cost is repeated cached context, not the final document length.

## Token evidence

### Whole historical run

| Metric | Tokens |
| --- | ---: |
| Input | 1,133,607 |
| Cache read | 12,677,597 |
| Completion | 478,582 |
| Reported total | 14,289,786 |

The historical total includes failed and superseded attempts made before the part protocol was installed, plus one interrupted reviewer start. It must not be presented as the clean cost of the final eight files.

### Eight final committed dispatches only

| Metric | Tokens |
| --- | ---: |
| Input | 721,199 |
| Cache read | 11,288,576 |
| Completion | 294,291 |
| Reported total | 12,304,066 |

Non-cache input plus completion was 1,015,490 tokens. Cache reads made up about 91.7% of the final-dispatch total.

### Post-fix documents using the part protocol

| Document | Successful part calls | Failed/local retries | Input | Cache read | Completion | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| UI/UX | 18 | 4 | 81,279 | 1,931,776 | 35,007 | 2,048,062 |
| Audio | 18 | 3 | 78,702 | 2,322,688 | 30,515 | 2,431,905 |
| Asset | 18 | 1 | 174,965 | 3,691,776 | 33,953 | 3,900,694 |
| **Total** | **54** | **8** | **334,946** | **7,946,240** | **99,475** | **8,380,661** |

Cache reads are about 94.8% of the post-fix total. The protocol requires 18 successful calls per document: header, ten sections, five production materials, audit and authority. Each small call reuses an increasingly large model conversation. This is why a 45–66 KB document can report two to four million tokens despite having reasonable final content.

## Root cause and observed recovery

The former one-shot protocol asked the model to place the entire document into one nested tool argument. A failed UI/UX attempt emitted 6,528 `input_json_delta` fragments and approximately 39,870 intended JSON characters, then ended with `Unfinished string at EOF`; Claude Code exposed the final tool input as `{}`. A previously successful Art payload was approximately 44,910 JSON bytes, demonstrating that the failure boundary is not a stable content-quality boundary.

The new server-persisted part protocol prevented that failure from destroying the document. UI/UX, Audio and Asset each completed; malformed or empty calls affected only the current part and were retried locally. No incomplete draft remained after authority commit.

## Decision

1. Keep server-owned deterministic rendering, durable drafts, strict ordering, digest verification and atomic final visibility.
2. Do not return to one-shot full-document JSON. It is observably unreliable near the current payload size.
3. Change the next optimization from one part per turn to a bounded batch of consecutive parts. A target of two or three parts and a hard serialized payload ceiling of roughly 12–16 KB should reduce successful calls from 18 to approximately 6–9 while retaining local recovery and staying well below the observed truncation region.
4. Remove unnecessary author-side `TodoWrite` and post-commit `Read` verification; the server receipt and digest are the verification authority.
5. Normalize heading depth and trim semantic restatement, especially in Art/UI/Asset. Treat this as a secondary 10–25% output optimization, not the primary token fix.
6. On the next clean measurement, report cache reads separately from fresh input and completion. A single combined `total_tokens` number obscures whether cost came from generated content, fresh reasoning or cached conversation replay.

## Final verdict

- Can BeeGameStudio now produce all eight documents? **Yes, verified in Chrome, 8/8 committed.**
- Are the documents empty, skeletal or unusable? **No. They are substantial and development-oriented.**
- Are they perfect? **No. Art/UI/Asset are overlong and their outline hierarchy can be improved.**
- Is the current token consumption normal? **No. The final content volume is defensible; the multi-million reported totals are dominated by repeated cache reads caused by 18 model turns per document.**
- Is the current protocol ready to be called token-optimized? **No. It is reliability-safe but still requires bounded multi-part batching before a clean rerun.**
