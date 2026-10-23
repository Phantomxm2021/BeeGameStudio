# BGS source and third-party notices

BGS (BeeGameStudio) is developed and maintained by PhantomLab.
The previous embedded CLI originated from https://github.com/claude-code-best/claude-code.
That CLI has been removed; the current runtime integrates the official
Codex executable (upstream Apache-2.0). Its official source is pinned as the
vendor/codex Git submodule; the @openai/codex package remains an explicit
release-binary option. BGS is an independent application.

Product branding does not transfer ownership of upstream or third-party code.
Original copyright and license notices must remain with the relevant code.
This notice does not grant a new license or declare a single license for the
entire repository.

The following existing component notices are included in the package:

- Scene editor UI: packages/scene-editor/src/components/ui/LICENSE
- BENCHO component: apps/frontend/src/components/Demiurge/Landing/vendor/BENCHO-LICENSE.txt
- COMPONENTRY component: apps/frontend/src/components/Demiurge/Landing/vendor/COMPONENTRY-LICENSE.txt

This list is not a complete license clearance of the application. Bundled
dependencies and other source must retain their own notices; release
maintainers must verify the applicable permissions before distribution.
