# Resolve runtime dependencies for this project

Read when selecting a new runtime/library version, diagnosing incompatible
packages, or performing a requested upgrade. An ordinary feature change reuses
the existing dependency decision and lockfile.

## New setup versus existing installation

For an existing project, compare its manifest range, lockfile resolution and
installed package. They answer different questions: `^3.90.0` permits compatible
3.x releases, while a lockfile can resolve exactly 3.90.0. Neither asks the
registry to choose 4.x. Do not infer an installed version from a tutorial title.

For a new setup, choose a supported release that fits the required capabilities,
companion packages and available implementation guidance. Compare relevant
versions when those constraints differ; neither the newest major nor an older
familiar release wins by default. Query release metadata for the candidate being
selected, including its engines and peer dependencies. For example:

```sh
npm view phaser@<candidate-version> version engines --json
npm view @react-three/fiber@<candidate-version> peerDependencies engines --json
```

A dist-tag such as `latest` is a publisher label, not a project requirement.
A newer release alone does not authorize migrating an existing game.

## Match documentation to the chosen runtime

Use the selected package's actual API and compatible typings, including add-ons,
renderer, React host and build-tool requirements where they interact. A React
application shell does not automatically select R3F; a Phaser 4 reference is not
a Phaser 3 migration request. Phaser carries its declarations; Three.js projects
may use separately versioned `@types/three`.

Retain the decision in the ordinary package manifest/lockfile and relevant code,
not another version registry or a copied full technical specification in GDD.
Use the existing package manager and inspect its resolved installation output;
examples and lockfiles are not substitutes for each other. Re-query only for a
new decision, changed compatibility constraint or specific unresolved mismatch.

Sources: [npm view](https://docs.npmjs.com/cli/v11/commands/npm-view/),
[dependency and peer declarations](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/),
[lockfile purpose](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json/).
