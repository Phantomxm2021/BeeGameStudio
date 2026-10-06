# Dots Lab integration

Source: https://dots-lab.pages.dev/ (retrieved 2026-10-01), by Guillaume / @guillaume_rygn.

`dots-lab.js` retains the original shape geometry, face drawing and animation choreography, including explanatory comments. The small adapter exposes one persistent canvas loop, blends expressions, respects reduced motion, fits the component bounds and uses the Idea Home monochrome palette.

`useDailyAvatar.ts` selects a daily appearance from the twelve shapes and five friendly eye styles, stored under `bgs-daily-avatar`. A browser-local calendar day keeps its appearance across reloads; a new day selects a different silhouette. Midnight and returning to a visible tab refresh the selection. Workflow state still determines expression, while theme determines the monochrome color. The former debug editor and its integration are removed.

Home sound recipes and synthesis are adapted from https://bencho.dev/sounds (MIT, Lorenzo Cabra). The six selected cues retain their original oscillator, filter and envelope values, with a 0.45 master gain. Sound starts only after a user click; mute persists in `bgs-home-sound`. See BENCHO-LICENSE.txt.

The decorative GrainGradient component comes from https://componentry.dev/docs/components/grain-gradient and the official harshjdhv/componentry repository (MIT, Harsh Jadhav). It uses the existing theme store with restrained grayscale palettes, and retains the upstream CSS fallback, visibility/reduced-motion handling, and WebGL cleanup. See COMPONENTRY-LICENSE.txt.
