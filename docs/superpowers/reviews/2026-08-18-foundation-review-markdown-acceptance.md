# Foundation Review Markdown Assembly Chrome Acceptance

Date: 2026-08-18

Branch: `codex/remediation-clean-slate`

Tested implementation: `ff7bed1b51ab34b2eb375f8516046399b667b425`

Verdict: **FAILED — presentation receipt rejected before synthesis**

## Scope and environment

Final acceptance attempt 5 exercised only the Foundation Reviewer path through
the Web/React Dashboard in the user's Chrome. It created a new project and run
from the previously accepted eight-document project
`floating-city-reef-restoration--c18e01c86ec5`. It did not retry or resume an
earlier run. No model setting, source document, native runtime core, or
acceptance project content was changed to influence the result.

- Fixed ports: frontend `62173`, runtime `62174`, billing `62175`, skills
  `62176`, resources `62177`
- Configured model: `ark-code-latest`
- Project: `review-copy--0a39f6ee-4d51-4e96-9237-5a4759927293`
- Project path: `/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/Projects/users/30fb0202-1f77-414f-82da-f92936e7bba3/review-copy--0a39f6ee-4d51-4e96-9237-5a4759927293`
- Workflow run: `9746a355-da3b-4af5-a965-a3c15180de94`
- Source revision: `8f4fc1352df7c4fe07e2aab40f878c284f01a52c4cf86b8f7a1d7805024c3e3a`
- Persisted workflow schema: `27`

## Chrome observation and exact failure boundary

The Dashboard exposed exactly four ordinary Reviewer tasks. The presentation,
technical/assets, and core-design dispatches started at
`2026-08-17T21:49:37.286Z`, `2026-08-17T21:49:37.300Z`, and
`2026-08-17T21:49:37.311Z`, a 25 ms concurrent start window. Chrome showed all
three lanes as `审计中` while synthesis remained `待审计`.

Core design and technical/assets became `已审计`. At elapsed `00:04:27`,
Chrome first showed presentation as `审计失败` with the exact error:

```text
foundation review lane Markdown evidence path is outside lane authority
```

Synthesis was still `待审计`. The workflow was stopped immediately through the
visible Chrome `Stop task` action. The stable Dashboard state is `已暂停`, with
core and technical/assets completed, presentation failed, and synthesis
pending. The visible `继续` action was not selected. No retry, resume, patch,
or later stage was attempted.

The exact failing workflow event is `dispatch.failed` for presentation at
`2026-08-17T21:53:23.267Z`, dispatch
`6d9ecf39-9781-43a9-b66f-5c13a94960a5`, with the reason above. The last native
event for that provider turn is `turn_terminal` at
`2026-08-17T21:53:23.046Z`, outcome `success`, last event type `result`, so this
was local receipt validation rather than a provider/stream error. After the
other already-running lane settled, the last native event overall was a
successful technical/assets `turn_terminal` at `2026-08-17T21:53:29.016Z`.
The final workflow event is the deliberate `run.stopped` at
`2026-08-17T21:54:12.039Z` with reason `user stopped workflow`.

## Four task outcomes and usage

Cache creation was zero for all three dispatched tasks. Durations are the
dispatch-start to terminal-event intervals; synthesis never dispatched.

| Task | Outcome | Duration | Input | Cache input | Output |
| --- | --- | ---: | ---: | ---: | ---: |
| Core design | completed; receipt committed | 211.998 s | 73,776 | 46,927 | 15,022 |
| Technical and assets | completed; receipt committed | 231.825 s | 57,905 | 14,304 | 15,595 |
| Presentation | failed local authority validation; no receipt committed | 225.982 s | 144,949 | 151,856 | 14,879 |
| Blocker synthesis | pending; never dispatched | n/a | 0 | 0 | 0 |
| **Reviewer total** | **failed and manually stopped** | **274.753 s UI wall** | **276,630** | **213,087** | **45,496** |

The three native sessions made ten tool calls, all `Read`: four core, two
technical/assets, and four presentation. They made zero actual
`StructuredOutput`, `Write`, `Edit`, shell, or Agent tool calls.

## Projection authority and persisted artifacts

Each lane request used only its canonical source documents plus its exact
projection file. For every lane, `protectedPaths` equals `sourcePaths`, and
the sole staging/committed output pair is the lane's exact `.md` receipt path.
The projection contracts match the persisted files byte-for-byte:

| Lane | Projection bytes | Contract and file SHA-256 |
| --- | ---: | --- |
| Core design | 143 | `e35c58f90e936b1fe6dc3a1542ad7ca0984c5b8f8af5eb59efb3f8438a887fa7` |
| Technical/assets | 90,087 | `b897a35673894f03d5d62bf0345cc0f8f50d9844d4779c5fd776eae3b84ed3ce` |
| Presentation | 57,474 | `a82b8755345a4acd44012eecd048eba6c481feccfcd1406898f06aeef4cec2e4` |

Raw tool-use records show every `Read` target is a contracted canonical source
or that lane's contracted projection. All three visible Markdown results carry
the exact contracted revision, lane, and `Projection:` digest. The presentation
result nevertheless cited the relative projection path as Evidence in multiple
candidates, and the local authority gate rejected the result with the exact
error above. Per acceptance scope this document records, but does not patch or
retry, that boundary.

Only two of the three required lane receipts were committed:

| Artifact | Result | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `parts/core-design.md` | committed | 20,569 | `680bc0e486977c1c3b31c5fefcf9fb6a1fcb5e56a19798b0f83812fceb2123b1` |
| `parts/technical-assets.md` | committed | 18,381 | `c5e82fd6afe29b1168e1d32fafe453815c1d5cf669cb880542d41077d9bc14cb` |
| `parts/presentation.md` | absent after rejection | n/a | n/a |
| `selection.md` | absent; synthesis not dispatched | n/a | n/a |
| `review.json` | absent; assembly not reached | n/a | n/a |

Because selection and canonical report do not exist, kept-record equality,
canonical replay, final-report revision/digest, implementation sufficiency,
and synthesis compactness are unfulfilled rather than passed.

## Native Markdown, retry, and stage boundary

- Recursive inspection found zero `workflowJsonSchema` fields in persisted
  Reviewer dispatches.
- Raw/native logs contain ten actual `Read` tool-use blocks and zero actual
  `StructuredOutput` blocks. Prompt prose mentioning the forbidden tool is not
  counted as a tool use.
- Exactly three `dispatch.started` events exist, all attempt-1
  `review:foundation:*:1` lane tasks and all worker type `document-reviewer`.
- Event types contain no retry, resume, or restart event. Task IDs are unique,
  `foundationReviewState.attempt` is `1`, and no implicit restart occurred.
- No synthesis, remediation, verification, checklist, resource,
  implementation, or acceptance dispatch exists.

## Source hash comparison

All eight canonical SHA-256 values were captured immediately after copy/start
and again after the stop boundary. Every value was unchanged.

| Source document | Before | After |
| --- | --- | --- |
| `docs/ART_DIRECTION.md` | `b5af13c4f065db0e490abcb62173a26e5fe354a8c4be5dd51de084e2cf7c4c79` | `b5af13c4f065db0e490abcb62173a26e5fe354a8c4be5dd51de084e2cf7c4c79` |
| `docs/ASSET_PLAN.md` | `a2ffd5c58965a00b9a441a797cfa1533a65a0132243145f8ff03dbf930962547` | `a2ffd5c58965a00b9a441a797cfa1533a65a0132243145f8ff03dbf930962547` |
| `docs/AUDIO_DESIGN.md` | `d4315cc4b6f88dd9604ea8c385f063a9d8f2c9f78b50e545c9c14f6e5e7fc4a9` | `d4315cc4b6f88dd9604ea8c385f063a9d8f2c9f78b50e545c9c14f6e5e7fc4a9` |
| `docs/BALANCE_DESIGN.md` | `63d03c0c55c587e70c178b5429a0e1fc299182381f1cdf88d08a3fa7cf10cdb9` | `63d03c0c55c587e70c178b5429a0e1fc299182381f1cdf88d08a3fa7cf10cdb9` |
| `docs/GDD.md` | `e80d64e803f144fa6b60c696159aab8f9523eb875c9ebbb219ddf46c23fee2e0` | `e80d64e803f144fa6b60c696159aab8f9523eb875c9ebbb219ddf46c23fee2e0` |
| `docs/LEVEL_SCENE_DESIGN.md` | `c5c6579348483a08a5dbd08af1e607a712e5d5fa50cd47111f3fb32eab35a784` | `c5c6579348483a08a5dbd08af1e607a712e5d5fa50cd47111f3fb32eab35a784` |
| `docs/TECHNICAL_DESIGN.md` | `1782c8af62fb2e83412af3fe76e0a54e9847c2dc789b539b1ef4f1e38c956a44` | `1782c8af62fb2e83412af3fe76e0a54e9847c2dc789b539b1ef4f1e38c956a44` |
| `docs/UI_UX_SPEC.md` | `4d6d9e89942120083461d55f73f1cb21a0c8154b786a4d4d92f0188cae8903cd` | `4d6d9e89942120083461d55f73f1cb21a0c8154b786a4d4d92f0188cae8903cd` |

## Acceptance matrix

| Requirement | Result | Evidence |
| --- | --- | --- |
| Three lane tasks started concurrently | pass | three starts within 25 ms |
| Native Markdown path only | pass | only `Read`; zero actual StructuredOutput and zero `workflowJsonSchema` |
| Strict shared projection inputs/digests | pass to dispatch/result identity | exact contracted files, digests, and allowed Read targets |
| Three exact `parts/*.md` receipts exist | **fail** | presentation receipt rejected; only two committed |
| Synthesis dispatch exists | **fail** | synthesis remained pending |
| One compact `selection.md` exists | **fail** | absent |
| One deterministic canonical `review.json` exists | **fail** | absent |
| All eight canonical source hashes unchanged | pass | before/after table above |
| No implicit restart or retry | pass | attempt 1, unique task IDs, no matching events |
| No remediation or verification dispatch | pass | three Foundation lane dispatches only |
| Kept conflicts are implementation-sufficient | unfulfilled | no selection or canonical report |

## Conclusion

Final attempt 5 does not accept the Reviewer path on tested commit
`ff7bed1b51ab34b2eb375f8516046399b667b425`. Chrome proved the three lanes
started concurrently through the native Markdown-only path and preserved all
sources, but presentation failed the local projected-evidence authority gate.
The run was stopped immediately, leaving synthesis and canonical assembly
unreached. No retry, resume, remediation, verification, or later workflow
stage ran.
