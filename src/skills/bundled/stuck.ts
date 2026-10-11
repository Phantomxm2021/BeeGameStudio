import { registerBundledSkill } from '../bundledSkills.js'

// Prompt text contains `ps` commands as instructions for BGS to run,
// not commands this file executes.
// eslint-disable-next-line custom-rules/no-direct-ps-commands
const STUCK_PROMPT = `# /stuck — diagnose frozen/slow BGS sessions

The user thinks another BGS session on this machine is frozen, stuck, or very slow. Investigate the relevant sessions and report the evidence to the user.

## What to look for

Scan for other BGS processes, excluding this session. The main process title is BGS; script builds can appear as bun/node with a BGS CLI entry path. A name match alone is not proof of ownership.

Signs of a stuck session:
- **High CPU (≥90%) sustained** — likely an infinite loop. Sample twice, 1-2s apart, to confirm it's not a transient spike.
- **Process state \`D\` (uninterruptible sleep)** — often an I/O hang. The \`state\` column in \`ps\` output; first character matters (ignore modifiers like \`+\`, \`s\`, \`<\`).
- **Process state \`T\` (stopped)** — user probably hit Ctrl+Z by accident.
- **Process state \`Z\` (zombie)** — parent isn't reaping.
- **Very high RSS (≥4GB)** — possible memory leak making the session sluggish.
- **Stuck child process** — a hung \`git\`, \`node\`, or shell subprocess can freeze the parent. Check \`pgrep -lP <pid>\` for each session.

## Investigation steps

1. **List candidate BGS processes** (macOS/Linux):
   \`\`\`
   ps -axo pid=,pcpu=,rss=,etime=,state=,comm=,command= | grep -E '(BGS|bee-game-studio|ccb|cli-(bun|node)|entrypoints/cli)' | grep -v grep
   \`\`\`
   Verify the executable/entry path belongs to the BGS installation or checkout. Do not treat an unrelated Claude, Bun or Node process as BGS.

2. **For anything suspicious**, gather more context:
   - Child processes: \`pgrep -lP <pid>\`
   - If high CPU: sample again after 1-2s to confirm it's sustained
   - If a child looks hung (e.g., a git command), note its full command line with \`ps -p <child_pid> -o command=\`
   - Check the session's debug log if you can infer the session ID: \`~/.claude/debug/<session-id>.txt\` (the last few hundred lines often show what it was doing before hanging)

3. **Consider a stack dump** for a truly frozen process (advanced, optional):
   - macOS: \`sample <pid> 3\` gives a 3-second native stack sample
   - This is big — only grab it if the process is clearly hung and you want to know *why*

## Report

If every relevant session looks healthy, say so. Otherwise summarize the observed symptom, likely cause, evidence and uncertainty. Include only the process details or log excerpts needed to explain the diagnosis; redact secrets and unrelated data.

If the user separately requests an external report, use their chosen destination and approved content. A stuck process is not by itself a request to send logs.

## Notes
- Don't kill or signal any processes — this is diagnostic only.
- If the user gave an argument (e.g., a specific PID or symptom), focus there first.
`

export function registerStuckSkill(): void {
  if (process.env.USER_TYPE !== 'ant') {
    return
  }

  registerBundledSkill({
    name: 'stuck',
    description:
      '[ANT-ONLY] Investigate frozen/stuck/slow BGS sessions on this machine and explain the diagnostic evidence.',
    userInvocable: true,
    async getPromptForCommand(args) {
      let prompt = STUCK_PROMPT
      if (args) {
        prompt += `\n## User-provided context\n\n${args}\n`
      }
      return [{ type: 'text', text: prompt }]
    },
  })
}
