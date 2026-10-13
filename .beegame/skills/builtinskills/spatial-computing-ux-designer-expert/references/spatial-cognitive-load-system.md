# Spatial Cognitive Load System

Rules:

- Keep a clear focal task
- Reduce competing floating UI when it obscures the player or environment
- Avoid conflicting spatial anchors
- Avoid rapid z-depth transitions

Goal:
Reduce disorientation.

For a concrete task, check what the player must notice, target and confirm in the same moment. Distinguish selecting an object from moving the viewpoint, and prevent an ambiguous activation from performing both actions. A lost panel or target needs a recoverable path, not another permanently floating panel.

Compare corresponding states after a modal, locomotion or tracking interruption: is the intended focus evident, is the primary information still locatable, and do hidden controls stop receiving input? A different anchoring choice may solve the specific problem; adding more depth or annotations may worsen it.

Use the applicable [Apple, Meta and Unity sources](../../spatial-computing-game-expert/references/spatial-rule-architecture.md), particularly the selected platform's input semantics. Do not assume every platform exposes gaze hover or shares a focus API. Keep usability risks separate from actual device/user observations; a synthetic persona cannot establish comfort or understanding.
