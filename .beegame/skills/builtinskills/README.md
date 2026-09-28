# BeeGameStudio built-in Skills

This directory is the shared, versioned source of BeeGameStudio built-in Skills.
Each immediate subdirectory containing `SKILL.md` is discoverable by the native
Agent. The Agent may choose and invoke a Skill; when Skill Search is enabled,
its normal relevance-based discovery may also surface Skill content. No
delivery phase forces a particular Skill invocation.

Only active domain Skills belong here. Removed Skills and their reasons are
listed in `docs/retired-skills/README.md`; they are not discoverable or packaged.

Runtime builds must package this directory unchanged. When the runtime is not
launched from the source tree, set `BEEGAME_BUILTIN_SKILLS_DIR` to its absolute
packaged path. Desktop clients that host their own runtime should package the
same directory and set that host-side variable. User-installed Skills remain in
the per-user runtime configuration and are not written into this catalog.
