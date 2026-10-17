import { mkdtemp, realpath, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Project-local entry stays readable; the implementation belongs to BGS.
 * Runtime access grants only its private module directory, not server sources. */
export const CONTENT_CHECKER_ENTRY = `// BGS-managed checker entry. Run --help for the interface; this is not game source.
try {
  if (!process.versions.bun) throw new Error('BGS_BUN_REQUIRED: Run this entry with bun, not node (including --help). The shared content/media/resource implementation targets Bun; this is not a missing project dependency.');
  const moduleUrl = process.env.BEEGAME_CONTENT_CHECKER_MODULE;
  if (!moduleUrl) throw new Error('Content checker runtime is unavailable. Run this command in the BGS project execution environment.');
  const { runGameContentCli } = await import(moduleUrl);
  await runGameContentCli(process.argv.slice(2), { profile: 'current' });
} catch (error) {
  console.log(JSON.stringify({ valid: false, issues: [error instanceof Error ? error.message : String(error)] }));
  process.exitCode = 1;
}
`

let checker: Promise<{ root: string; path: string; moduleUrl: string; uiLayoutToolPath: string }> | undefined
export const CURRENT_CONTENT_CHECKER_ENTRY = CONTENT_CHECKER_ENTRY
export const CONTENT_BINDING_ENTRY = CONTENT_CHECKER_ENTRY.replace('checker entry', 'binding entry').replace('runGameContentCli', 'runContentBindingCli').replace('runGameContentCli', 'runContentBindingCli')
export const MEDIA_PRODUCTION_ENTRY = CONTENT_CHECKER_ENTRY.replace('checker entry', 'media entry').replaceAll('runGameContentCli', 'runMediaProductionCli')
export const RESOURCE_PRODUCTION_ENTRY = CONTENT_CHECKER_ENTRY.replace('checker entry', 'resource entry').replaceAll('runGameContentCli', 'runResourceProductionCli')
export const DRAFT_EDITS_ENTRY = CONTENT_CHECKER_ENTRY.replace('checker entry', 'draft editing entry').replaceAll('runGameContentCli', 'runDraftEditsCli')
export const COMPOSE_DRAFT_ENTRY = CONTENT_CHECKER_ENTRY.replace('checker entry', 'draft composition entry').replaceAll('runGameContentCli', 'runComposeDraftCli')
export function sharedContentChecker(): Promise<{ root: string; path: string; moduleUrl: string; uiLayoutToolPath: string }> {
  return checker ??= (async () => {
    // Build in a fresh process: repeated in-process Bun builds can misresolve
    // package-scoped imports in the long-lived server.
    const child = Bun.spawn([process.execPath, 'build',
      fileURLToPath(new URL('./game-content-validation-cli.ts', import.meta.url)),
      '--target=bun', '--production'], { stdout: 'pipe', stderr: 'pipe' })
    const [code, source, error] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ])
    if (code !== 0 || !source) throw new Error(`Cannot prepare content checker: ${error}`)
    const root = await realpath(await mkdtemp(join(tmpdir(), 'beegame-checker-')))
    const path = join(root, 'check-content.mjs')
    await writeFile(path, source, { flag: 'wx', mode: 0o400 })
    // Publish the small Node adapter beside existing host utilities. Bun's
    // resolver needs directory reads; never grant the server source directory.
    for (const name of ['preview-test-command.mjs', 'preview-test-client.mjs', 'preview-play-capture.mjs', 'sprite-sample.mjs'])
      await writeFile(join(root, name), await readFile(new URL('./'+name, import.meta.url)), { flag: 'wx', mode: 0o400 })
    const uiSource = new URL('../../../scene-editor/src/ui-preview/uiStaticInspection.tsx', import.meta.url)
    const uiBuild = Bun.spawn([process.execPath, 'build', fileURLToPath(uiSource), '--target=browser', '--minify'], { stdout: 'pipe', stderr: 'pipe' })
    const [uiCode, uiScript, uiError] = await Promise.all([uiBuild.exited, new Response(uiBuild.stdout).text(), new Response(uiBuild.stderr).text()])
    if (uiCode !== 0 || !uiScript) throw Error('Cannot prepare shared UI inspector: ' + uiError)
    await writeFile(join(root, 'ui-inspector.mjs'), uiScript, { flag: 'wx', mode: 0o400 })
    await writeFile(join(root, 'ui-inspector.css'), await readFile(new URL('UiContentRenderer.css', uiSource)), { flag: 'wx', mode: 0o400 })
    // inspect-design is a Node entry; do not import the Bun-only checker there.
    const manifestBuild = Bun.spawn([process.execPath, 'build', fileURLToPath(new URL('./asset-contracts.ts', import.meta.url)),
      '--target=node', '--production'], { stdout: 'pipe', stderr: 'pipe' })
    const [manifestCode, manifestSource, manifestError] = await Promise.all([manifestBuild.exited, new Response(manifestBuild.stdout).text(), new Response(manifestBuild.stderr).text()])
    if (manifestCode !== 0 || !manifestSource) throw Error('Cannot prepare inspector manifest reader: ' + manifestError)
    await writeFile(join(root, 'inspection-manifest.mjs'), manifestSource, { flag: 'wx', mode: 0o400 })
    const fontBuild = Bun.spawn([process.execPath, 'build', fileURLToPath(new URL('./font-inspection.ts', import.meta.url)),
      '--target=node', '--production'], { stdout: 'pipe', stderr: 'pipe' })
    const [fontCode, fontSource, fontError] = await Promise.all([fontBuild.exited, new Response(fontBuild.stdout).text(), new Response(fontBuild.stderr).text()])
    if (fontCode !== 0 || !fontSource) throw Error('Cannot prepare font inspector: ' + fontError)
    await writeFile(join(root, 'font-inspection.mjs'), fontSource, { flag: 'wx', mode: 0o400 })
    const toolBuild = Bun.spawn([process.execPath, 'build', fileURLToPath(new URL('./ui-layout-tool.ts', import.meta.url)),
      '--target=bun', '--production'], { stdout: 'pipe', stderr: 'pipe' })
    const [toolCode, toolSource, toolError] = await Promise.all([toolBuild.exited, new Response(toolBuild.stdout).text(), new Response(toolBuild.stderr).text()])
    if (toolCode !== 0 || !toolSource) throw Error('Cannot prepare UI layout tool: ' + toolError)
    const uiLayoutToolPath = join(root, 'ui-layout-tool.mjs')
    await writeFile(uiLayoutToolPath, toolSource, { flag: 'wx', mode: 0o400 })
    return { root, path, moduleUrl: pathToFileURL(path).href, uiLayoutToolPath }
  })().catch(error => { checker = undefined; throw error })
}
