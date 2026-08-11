# BGS–Claude Code Workflow Boundary Design

## Objective

Preserve the existing Bee Game Studio document workflow while removing every BeeGame-specific mechanism that changes how Claude Code thinks, selects or uses native tools, writes documents, or declares a normal turn complete.

Bee Game Studio is the workflow orchestrator. Claude Code is the worker. BGS may assign work and observe its outcome; it must not become an execution controller layered over Claude Code.

## Proven Root Cause

The exact current GDD assignment succeeds when sent directly to Claude Code with thinking enabled and native file tools. That run produced a 94,124-byte, 842-line GDD with all twelve required sections and passed `validateCompleteGameDocumentMarkdown`.

The BeeGame path instead required the entire Markdown body inside one `CommitCanonicalDocument({ body })` JSON tool argument. The provider emitted `content_block_start` for that tool but no `input_json_delta`, then the workflow stalled. A small body completed normally. The model, prompt, thinking mode, and Claude Code document-writing ability are therefore not the failure source; the BGS execution boundary is.

## Responsibility Boundary

### BGS may

- select the next existing workflow node;
- send the node's business prompt, approved authority context, target document path, and user-configured model environment to Claude Code;
- forward Claude Code events without reinterpretation;
- observe normal completion, produced files, errors, and usage;
- schedule the existing review or remediation node after a worker completes;
- display workflow state and document results.

### BGS must not

- disable, reduce, or replace Claude Code thinking;
- remove or substitute Claude Code native tools for document workers;
- impose BeeGame-specific Read, Write, Edit, Bash, or file-path permission decisions on Claude Code;
- require `CommitCanonicalDocument` or another BeeGame terminal tool for document delivery;
- serialize a complete document into a custom tool argument;
- require terminal JSON or synthetic completion prose when Claude Code has normally ended its turn;
- classify a normal document-author `end_turn` as failure only because no BeeGame tool was called;
- interrupt an active native thinking, tool, or file-writing stream through a BeeGame-specific idle policy;
- rewrite the user-selected provider or model policy beyond passing the configured environment to Claude Code;
- modify the Claude Code repository to compensate for a BeeGame workflow defect.

These restrictions apply to the document-author path. Other BeeGame business workers are not refactored unless an observed shared mechanism demonstrably changes document-author behavior.

## Preserved Workflow

The current workflow graph remains authoritative:

```text
Idea → confirmed direction/brief → document author node
     → document review node → targeted remediation when required
     → next document node → complete document delivery
```

The author node sends the existing discipline prompt and projected upstream authority to Claude Code. Claude Code writes the assigned project document with its native runtime and ends normally. BGS records the observed result and advances the same workflow. Review and remediation remain separate Claude Code assignments rather than hidden BGS rewriting.

## Boundary Audit

Before changing completion semantics, compare the successful direct Claude Code launch with the BGS launch. Capture and diff:

- model and provider environment;
- thinking configuration;
- system and user prompts;
- native tool inventory;
- permission callbacks and sandbox decisions;
- working directory and target path;
- stream events, watchdog decisions, retries, and terminal reason;
- document file mutations and final filesystem state.

Audit the known BeeGame intervention points:

- `selectBeeGameWorkerTools`;
- `getBeeGameWorkflowThinkingConfig`;
- `getBeeGamePermissionPolicyDecision`;
- document-author sandbox and allowed-path injection;
- `CommitCanonicalDocument` registration and prompts;
- `workflowResultInstruction`;
- document-author terminal classification and recovery;
- native stream watchdog and idle restart logic;
- provider/environment rewriting.

Each document-author-specific delta must either be removed or justified as passive metadata that cannot alter Claude Code execution.

## Correct Completion Semantics

A document author completes through Claude Code's normal runtime lifecycle. BGS must not require a custom terminal tool. The workflow observes the assigned document and the normal terminal event, then hands that result to the existing review stage.

Missing files, runtime failures, or incomplete work remain observable workflow outcomes. Recovery is performed by sending a new remediation request through the existing workflow, not by taking over Claude Code's file operations or silently rewriting its output.

## Verification Strategy

### Boundary regression tests

- document-author thinking is not overridden;
- the document-author receives the native tool inventory unchanged;
- the BeeGame permission policy does not make document-author file decisions;
- no document prompt or terminal instruction requires `CommitCanonicalDocument`;
- a normal `end_turn` with the assigned document present is accepted;
- no tool call is required to recognize completion;
- active thinking and native file activity prevent an idle restart.

### Direct-vs-BGS diagnostic test

Run the same current GDD prompt through direct Claude Code and through BGS. Persist both launch contracts and raw streams. Differences are acceptable only for workflow correlation metadata and the business prompt envelope.

### Chrome acceptance

Start every service on fixed ports:

- frontend `62273`;
- runtime `62274`;
- billing `62275`;
- skills `62276`;
- resources `62277`.

Use controlled Chrome to submit an ordinary game idea and run the existing workflow. Verify that Claude Code writes the complete document set, review/remediation progresses, and the UI exposes the resulting documents. Do not hardcode the acceptance idea into product logic or fixtures.

### Document quality

After the Chrome workflow produces real documents, combine two forms of evidence:

1. code-level contract and boundary tests;
2. inspection of the actual generated documents for completeness, cross-document consistency, and production usability by human game-development disciplines.

Neither source alone is sufficient for completion.

## Completion Criteria

- The existing Idea-to-document workflow completes through controlled Chrome on the fixed ports.
- Claude Code thinking and native tools remain unchanged by the document-author business layer.
- Document delivery does not depend on a BeeGame custom terminal tool or large JSON argument.
- All required documents are real, complete production documents rather than skeletons or MVP placeholders.
- Review and remediation remain workflow nodes executed by Claude Code.
- The direct and BGS runs differ only where workflow orchestration requires business context or correlation metadata.
- No test idea, project name, platform, engine, or generated wording is embedded in product logic.
