# BeeGame / Claude Code boundary

BeeGame is a multi-user platform shell around Claude Code. It is not a second
Agent runtime or workflow coordinator.

## BeeGame responsibilities

- Authenticate users and isolate each user's project workspace.
- Apply billing, platform permissions and administrator feature availability.
- Start, resume and stop one native Claude Code session at the user's request.
- Transport, persist and render native session events without rewriting their
  content.
- Forward permission decisions and native background-task notifications.
- Provide platform capabilities such as Resource Library, preview and
  deployment without deciding how Claude Code uses them.
- Record qualified native Reviewer, Auditor and Validator terminal evidence for
  deployment policy. Qualification may verify that the native Agent read the
  current deterministic contract and returned complete structured coverage; it
  must not decide what the Agent does next.
- Mark an unterminated turn as interrupted after a process or service restart.

## Prohibited BeeGame responsibilities

- Selecting a Skill, Agent, tool, implementation strategy or repair sequence.
- Starting, polling, reviving, retrying or replacing a Reviewer, Validator or
  other subagent on Claude Code's behalf.
- Injecting instructions about how Claude Code should use TaskOutput,
  SendMessage, background tasks, Skills or Validators.
- Rewriting, repairing, truncating or interpreting native assistant content.
- Treating an intermediate result, tool output, test log or timeout as task
  completion.
- Automatically continuing or repairing a task after failure or validation.
- Maintaining a parallel Agent phase machine that advances independently of
  the native session.

## Allowed prompts

BeeGame may transmit only user-authorized intent:

- The user's chat message and attachments.
- The confirmed structured game brief selected by the user.
- A literal continue request initiated by the user.
- Diagnostics attached to an explicit user action such as “repair build” or
  “repair deployment”.
- The user's selected response, document and player-visible language.
- The native delivery Skill entrypoint when the user explicitly starts BeeGame's
  complete-game delivery workflow. Selecting that product workflow authorizes
  loading its delivery contract; it does not authorize BeeGame to choose the
  Skill's tools, subagents, implementation plan or repair sequence.

These prompts must not prescribe Claude Code's internal workflow.

The complete-game delivery entrypoint is not an administrator feature default
or an inferred Agent choice. It is the native workflow the user selected by
confirming a full game build. BeeGame may expose and name that entrypoint in the
submitted prompt, just as a user can invoke a Skill in Claude Code TUI. After
the entrypoint is loaded, Claude Code exclusively owns planning, Skill/tool and
subagent selection, validation timing, repair and completion.

Enabling a capability in administrator settings only makes that capability
available. It must not silently become a project preference, an Agent choice,
or an instruction to use the capability. Project preferences come from the
user's confirmed brief.

## Review invariant

Any future change that can alter what Claude Code does next, which Agent it
calls, when it retries, or whether its work is complete belongs in Claude Code
or user-authored configuration—not in BeeGame. BeeGame changes may observe and
display those decisions but may not create them.

The complete document-led game delivery, native Subagent, Resource Library and
response-language architecture is recorded in
[BeeGame native Claude Code game delivery architecture](./beegame-native-game-delivery-architecture.md).
