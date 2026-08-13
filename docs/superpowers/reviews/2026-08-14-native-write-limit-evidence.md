# Native Write Limit Evidence

## Boundary

The native `Write` input schema is the only owner of the per-call content
limit. Workflow contracts and prompts cannot forward `nativeWriteLimit` or
`maxNativeWriteContentChars`. The measurement runner accepts a prebuilt native
executable for each candidate; it does not expose a runtime environment or BGS
control that can alter the limit.

## Selection rule

- Each of 8192, 10240 and 12288 characters requires three fresh runs.
- Every candidate run must complete, pass the canonical GDD validator and keep
  its maximum stdout silence at or below 120 seconds.
- 12288 is selected only with at least 15% lower median raw processed tokens
  than 8192. Otherwise 10240 requires at least 10%. Otherwise 8192 remains.

## Current status

The evidence parser, runner, boundary test and deterministic selection rule are
implemented and verified. Real model measurements remain intentionally
unclaimed because the selected user model configuration is held by the Web
React application rather than the current shell. They will run through the
fixed-port Chrome acceptance so the user-selected model remains authoritative.
Until nine valid results exist, the production limit remains 8192 characters.

| Limit | Run 1 | Run 2 | Run 3 | Verdict |
| ---: | --- | --- | --- | --- |
| 8192 | pending | pending | pending | retained by default |
| 10240 | pending | pending | pending | no production change |
| 12288 | pending | pending | pending | no production change |
