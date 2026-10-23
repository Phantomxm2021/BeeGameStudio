import { chromium } from '/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/.worktrees/ir-workflow-integration/packages/agent-workflow-server/node_modules/playwright-core/index.mjs'
import { resolveTestBrowserExecutable } from '/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/.worktrees/ir-workflow-integration/packages/agent-workflow-server/src/beegame/preview-test-browser.ts'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
const svg=await readFile(join(import.meta.dir,'projects/users/spatial-test/design-tools-retest-breakout-20261001/docs/concept/breakout_concept.svg'),'utf8')
const browser=await chromium.launch({executablePath:await resolveTestBrowserExecutable(),headless:true,args:['--mute-audio']})
try {
  const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1})
  await page.setContent('<!doctype html><style>body{margin:0}svg{display:block;width:1280px;height:720px}</style>'+svg)
  await page.screenshot({path:join(import.meta.dir,'concept-independent-audit.png')})
  console.log(JSON.stringify({rendered:true,sourceUnmodified:true,nativeAuthorVisualEvidence:false}))
}finally{await browser.close()}
