# Removed built-in Skills

These Skills were removed from the active catalog. No copies are shipped with
BeeGameStudio clients. Historical sources remain in version control and prior audit snapshots.

| Skill | Why retired |
| --- | --- |
| `brainstorming` | Imposes a mandatory design-and-approval gate even for tiny fixes. |
| `interview` | Forces a Chinese-only, continuous questionnaire regardless of user preference. |
| `finishing-a-development-branch` | Handles source-branch integration, not game creation or validation. |
| `react-vite-vertical-slice` | Assumes a historical DAC task and mandates React/Vite implementation order. |
| `beegame-game-delivery` | Duplicates delivery-state responsibilities and broadly matches nearly every game task. |
| `beegame-game-acceptance` | Duplicates the task's verification requirements rather than adding domain expertise. |
| `react-best-practices` | Generic, opinionated framework rules; use current project conventions and framework documentation instead. |
| `game-plan-execution` | Duplicates native execution and specialist checks; no separate execution/planning Skill is required. |
| `evidence-before-completion` | Duplicates claim/evidence guidance across execution and inspection; no separate evidence wrapper is required. |
| `bgs-imagegen` | Duplicates and modifies the system `imagegen` Skill while mixing platform API, handoff and resource-registration responsibilities. Use the unchanged system Skill and current tool contracts. |
| `game-implementation-planning` | Duplicates native task organization and adds planning/evidence duties. Runtime dependency guidance remains in the shared references; the planning Skill and generic evidence reference are removed. |
| `root-cause-debugging` | Repeats native coding-agent diagnosis and regression responsibilities; use the relevant engine/resource methods for a specific failure rather than another generic execution Skill. |
| `gameplay-programmer` | Duplicates native implementation and diagnosis duties. React/Phaser integration remains in the Phaser reference; runtime dependency guidance remains in shared references. The general gameplay diagnosis entry and reference are removed. |
| `git-workflow` | Generic Git operations and safety guidance duplicate native coding-agent capabilities and repository conventions; no game-domain method or production integration requires a separate built-in entry. |
