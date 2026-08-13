# Native GDD Efficiency Chrome Acceptance

## Boundary

- Date: 2026-08-14 (Asia/Shanghai)
- Surface: user Chrome, Web React only
- Fixed ports: frontend `62173`, runtime `62174`, billing `62175`, skills `62176`, resources `62177`
- Stop boundary: immediately after the first GDD was accepted, before the second document authored content
- BGS boundary: the workflow supplied product authority and a literal mechanical Markdown protocol; the native author chose every read and file mutation

## Failure sample that exposed the protocol defect

- Project: `abyssal-research-station--575f08c57b5b`
- Initial GDD body: 49,727 bytes, 730 lines
- Initial usage before correction: 33,198 input + 235,883 cache read + 25,486 output = 294,567 raw tokens
- Failure: the author used translated H2 headings and omitted the validator-only HTML markers and Production Materials wrapper
- Correction consequence: sequential heading edits raised the observed run total above one million raw tokens, then the one-correction boundary stopped explicitly
- Root cause: `completeDocumentContract` exposed IDs and titles but not the literal Markdown protocol required by `validateCompleteGameDocumentMarkdown`
- Fix: commit `7b8f7828` serializes exact summary, section, production wrapper and material marker/heading pairs; it does not author prose or select native tools

## Passing fresh sample

- Project: `desert-dig-supply-route--d86a691358ef`
- Selected direction: 七日补给线勘探模式
- GDD: `docs/GDD.md`
- Final size: 46,217 bytes, 683 lines including deterministic front matter
- Native body generation: 5 Write + 2 Read, 0 Edit, 0 correction turns
- Duration: 440,454 ms (7m 20.454s)
- Usage: 49,052 fresh input + 194,625 cache read + 25,804 output = **269,481 raw tokens**
- Authority projection: 336 bytes
- Mechanical validator: passed after stripping the deterministic five-line front matter, matching the commit path
- UI evidence: `游戏设计文档 GDD / 已完成 / 任务 1 / 8`; workflow stopped while the second document had only read its authority and had not created a file

## Intrinsic quality audit

- Complete canonical structure: executive summary, 12 discipline sections and 3 production materials
- 63 headings, 395 table lines and 2 Mermaid diagrams
- Concrete player actions, state flow, 13 core rules, priority ordering, win/failure/recovery semantics and cross-discipline ownership boundaries
- No skeleton, placeholder, copied example, YAML authored by the Agent, or audit appendix
- Human-team usability: production decisions and delegation boundaries are findable through tables and stable rule IDs
- Implementation-Agent usability: verbs, states, transitions, invariants and acceptance conditions are explicit enough to decompose into engineering tasks

## Verdict

Quality, durability and the no-hidden-correction requirement pass. The original
`220,000` estimate was not compatible with the measured 46 KB production GDD.
The evidence-calibrated GDD ceiling is now `280,000`; the observed `269,481`
passes with 10,519 tokens of headroom while preserving the governing
eight-document ceiling of 2.4 million. The five Write payloads were 3,856 /
4,872 / 3,286 / 4,136 / 7,325 characters, so increasing the 8K native limit
would not merge them. No content requirement or BGS boundary was weakened.
