# Resource semantic contract

BeeGame distinguishes the container-level Pack description from the
element-level capability used by AI selection.

| Layer | Purpose | May satisfy a project slot? |
| --- | --- | --- |
| Pack `style`, `dimension`, `gameTypes` | Shared art direction and compatibility | Yes, as hard constraints |
| Pack `tags` | Library discovery, governance and administration | No |
| Element `category`, `kind`, `format` | File/resource form | Yes, as hard constraints |
| Element `usageTags` | Explicit gameplay/art capability | Yes, as the only tag-based slot match |
| Project slot `resource_requirement.tags` | What the project needs | Requires an intersection with element `usageTags` |

This separation is intentional: a Pack can contain a character, a prop and a
texture; a Pack-level tag cannot establish that every file is a character.

## Canonical usage vocabulary

`character`, `npc`, `creature`, `weapon-equipment`, `prop`, `vehicle`,
`building`, `environment`, `terrain`, `vegetation`, `scene`, `level-map`,
`tile`, `ui`, `icon`, `effect`, `combat`, `interaction`, `narrative`,
`music`, `sound-effect`, `ambient-audio`, `voice`.

The Resource Pack inspector is the authority for assigning these capabilities.
They must not be inferred from a filename, folder, extension, title, or an
LLM-generated guess.

## Operational rules

1. A ready element without `usageTags` remains browseable and manually usable,
   but cannot be automatically selected for a tagged project slot.
2. Publishing blocks when a ready element has no explicit capability. This
   prevents newly published ambiguous assets.
3. Existing serialized `specs.usageTags` remains a temporary read fallback.
   The SQL migration carries forward only values already in the canonical
   vocabulary; everything else is deliberately left unclassified for admin
   review.
4. A resource selection must satisfy published Pack, ready element, dependency,
   category, format, dimension, style, game type and element capability checks.
   If no compatible element exists, the project slot remains `missing` or
   `placeholder`; it is never silently substituted.
