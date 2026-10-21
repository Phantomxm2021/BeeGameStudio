import { realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Compatibility for existing project tests. Preview owns the one implementation.
export async function withPlayCapture(options, inspect) {
  if (!process.env.BEEGAME_PREVIEW_TEST_MODULE) throw Error('No current supplied Preview helper');
  const helper = await import(process.env.BEEGAME_PREVIEW_TEST_MODULE);
  if (typeof helper.withPlayCapture !== 'function') throw Error('Current Preview helper lacks withPlayCapture; update BGS');
  return helper.withPlayCapture(options, inspect);
}

export const help = `Use const {withPlayCapture} = await import(process.env.BEEGAME_PREVIEW_TEST_MODULE) in a project-owned Node test.
Run through preview.mjs --run. The existing Skill import forwards to the same Preview implementation.
Video, selected stills and optional selected-node audio are observations, not quality acceptance. No chosen node means explicitly unverified audio.`;
const invokedFile = process.argv[1] ? await realpath(process.argv[1]).catch(() => undefined) : undefined;
if (invokedFile && import.meta.url === pathToFileURL(invokedFile).href) {
  if (process.argv.length === 3 && process.argv[2] === '--help') console.log(help);
  else { console.error(help); process.exitCode = 1; }
}
