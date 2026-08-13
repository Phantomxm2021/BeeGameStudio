# Foundation Document Streaming Chrome Acceptance

## Scope

- Date: 2026-08-13 (Asia/Shanghai)
- Browser: user Chrome, Web React application
- Fixed ports: frontend `62173`, runtime `62174`, billing `62175`, skills `62176`, resources `62177`
- Acceptance boundary: generate one fresh GDD, stop before the next document writes content
- Runtime boundary: BGS supplied the bounded group contract and mechanically authorized the native `Write`/`Edit`; it did not author or rewrite the document body

## Fresh project

- Project: `Projects/users/30fb0202-1f77-414f-82da-f92936e7bba3/island-wetland-restoration--cb3551eeeb63`
- Input: a single-player, top-down island ecology restoration and community-management game for Web/React
- Selected direction: `湿地复育季度攻坚模式`
- GDD: `docs/GDD.md`
- Receipt: `.beegame/workflow/document-commits/dc7b1f83-e325-46a5-9e6a-e22ba6a76d3b.json`
- Final SHA-256: `6c2f5481e3d36d709e1dc574d0627bf3419b970e6579536bc7000943c9f74b11`
- Final size: 61,554 UTF-8 bytes, 863 lines
- `docs/` files after stopping: one (`GDD.md`); the next document performed reads only and created no document file

## Runtime evidence

- GDD commit-point usage: 98,783 fresh input + 1,520,013 cache-read + 41,873 completion = **1,660,669 total tokens**
- Acceptance ceiling: 1,800,000 total tokens; headroom: 139,331 tokens
- Wall time from first document turn (`01:00:15.072Z`) to committed result (`01:15:39.314Z`): **15m 24.242s**
- Maximum consecutive runtime-log event gap across the completed GDD turns: **44.018s**, below the 45s stop threshold
- Final resumed dispatch: 37,913 fresh input + 1,014,868 cache-read + 24,923 completion = 1,077,704 tokens; 507,303ms; projection 98 bytes; Markdown body 61,479 bytes; no retry reason
- Native file mutations were bounded cursor transitions: one preamble write, one complete section edit per semantic section, and one edit per production material. No target-file shell mutation or completed-prefix rewrite was observed.
- The UI advanced to the next document after committing the GDD. It was stopped immediately. Its three reads added 77,920 tokens, so the final UI counter was 1,738,589; those tokens are not attributed to the committed GDD.

### Monitoring interruption

At group 6, the summary log had not yet flushed and was incorrectly read as a greater-than-45-second silence. The browser stop control was used once. Raw native events later showed a 34.353-second maximum gap and a completed `Edit` before that stop. Resume continued from durable cursor 6 without rewriting completed content. This was an acceptance-monitor mistake, not a runtime retry, rejection, or document corruption.

## Mechanical document validation

- `validateCompleteGameDocumentMarkdown('docs/GDD.md', body)`: passed
- Canonical section markers: 12/12
- Production material markers: 3/3
- Mechanical audit: `canonicalStructure`, `productionMaterials`, and `repeatedContent` all `passed`
- Document receipt digest equals the on-disk SHA-256
- No draft cursor remains
- Placeholder scan found no actual placeholder. The sole text match was the GDD's own requirement that content contain no placeholder strings.

## Independent quality audit

The document is a usable production GDD rather than a skeleton:

- 12 discipline-owned body sections, 77 subheadings, 220 table rows, 12 acceptance-criteria groups, and 2 Mermaid production diagrams
- Concrete product authority: player promise, target audience, scope and explicit non-goals
- Concrete gameplay authority: three nested loops, quarterly settlement order, resources, verbs, targeting, control mapping, four ecological indicators, rule priority, entity and interaction matrices
- Concrete progression and failure authority: T1-T4 permit progression, a 12-quarter cadence, reward boundaries, three failure modes, recovery semantics, deterministic replay, and fairness constraints
- Concrete production authority: hard content quotas, dependencies, assumptions, risk register, decisions that must close before implementation, observable success metrics, accessibility/localization requirements, and privacy boundaries
- Production materials are complementary rather than duplicated prose: a compact product/gameplay table, a core-loop diagram, and a global state-flow diagram
- Human readability: headings and tables make decisions findable; the prose explains trade-offs and delegates downstream balance values instead of pretending they are final
- Agent implementation usefulness: state transitions, units, invariants, ownership boundaries, content counts, and acceptance criteria can be converted into engineering and test work without reconstructing the design from narrative prose

No substantive duplicate block was detected. There is deliberate summary-level repetition in the production overview, but it acts as a downstream quick-reference artifact and is materially shorter than the owning sections.

## Code verification

Fresh verification after Chrome acceptance:

- Focused Bun suites: **22 passed, 0 failed, 100 assertions**
- `bun run typecheck`: passed (`tsc --noEmit`)
- `git diff --check`: passed

## Verdict

The one-document Chrome acceptance passes its defined quality, durability, latency, and token ceilings. The regression that repeatedly caused oversized one-shot GDD writes is removed from this path: normal semantic sections are now individually bounded and durably committed through the existing single native workflow. This evidence does not claim that all eight documents have been generated in one run; the test intentionally stopped after the GDD so its cost and quality could be measured without contamination from later documents.
