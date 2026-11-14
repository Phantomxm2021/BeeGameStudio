# Physical Safety Framework

Evaluate:

- Required rotation range
- Required arm elevation time
- Environmental collision risk

Use the target platform's play-area guidance and the supported seated, stationary, or room-scale mode. Do not assume one minimum room size fits every spatial game. If the required movement exceeds the available safe area, provide a mode or boundary behavior appropriate to the product.

For an actual task, inspect the required reach/turning, tracking-loss response and a usable stop/recenter path. For example, a required object outside the declared seated reach is a placement/input dependency, not a reason to instruct the player to stretch farther. A virtual collision check does not establish real-world clearance.

Use [Meta's comfort guidance](https://developers.meta.com/vr/design/comfort/) for the relevant device's physical/spatial considerations and [Apple's gesture guidance](https://developer.apple.com/design/human-interface-guidelines/gestures/) for visionOS custom-input ergonomics and system-gesture interactions. Interpret them within the supported platform and mode; do not copy their recommendations into a universal safe radius or duration. Device boundaries and a successful test are safeguards/evidence, not a guarantee against all physical risk.
