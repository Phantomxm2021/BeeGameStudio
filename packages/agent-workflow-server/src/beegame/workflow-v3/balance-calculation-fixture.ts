import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BALANCE_CALCULATOR_PATH } from '../balance-calculation'
// Existing calculation fixtures need an executable retained helper, not the retired
// production installer/upgrader. This fixture never replaces an existing helper.
let calculationFixture:Promise<string>|undefined
export async function writeBalanceCalculatorFixture(root:string) {
  calculationFixture??=(async()=>{
    const child=Bun.spawn([process.execPath,'build',fileURLToPath(new URL('../balance-calculation.mjs',import.meta.url)),'--target=bun','--production'],{stdout:'pipe',stderr:'pipe'})
    const [code,source,error]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()])
    if(code!==0||!source)throw Error('Cannot bundle calculation fixture: '+error)
    return source
  })()
  const target=resolve(root,BALANCE_CALCULATOR_PATH)
  await mkdir(dirname(target),{recursive:true})
  await writeFile(target,await calculationFixture,{flag:'wx'})
}
