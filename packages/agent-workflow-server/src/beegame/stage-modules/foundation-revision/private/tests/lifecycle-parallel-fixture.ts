import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const documents = JSON.parse(Buffer.from(process.argv[2]!, 'base64').toString('utf8')) as Record<string, string>

const contract = JSON.parse(process.env.BEEGAME_REVISION_CONTRACT ?? '{}') as {
  documentPath?: string
}
const stagedPath = process.env.BEEGAME_REVISION_STAGED_PATH
const controlDirectory = process.env.BEEGAME_CONFIG_DIR
const sessionId = '123e4567-e89b-12d3-a456-426614174000'
const markerName = (documentPath: string) =>
  `${documentPath.replaceAll('/', '_')}.ready`

function emit(value: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

async function run() {
  if (!contract.documentPath || !stagedPath || !controlDirectory)
    throw new Error('parallel fixture contract is incomplete')
  if (!readFileSync(stagedPath, 'utf8').startsWith('# incomplete'))
    throw new Error('parallel fixture received a non-incomplete assignment')

  const readyDirectory = join(controlDirectory, 'ready')
  const readyPath = join(readyDirectory, markerName(contract.documentPath))
  await mkdir(readyDirectory, { recursive: true })
  await writeFile(readyPath, contract.documentPath, { flag: 'wx' })
  while (!existsSync(join(controlDirectory, 'release')))
    await new Promise(resolve => setTimeout(resolve, 5))

  const body = documents[contract.documentPath]
  if (!body) throw new Error('parallel fixture document is unknown')
  emit({
    type: 'result',
    session_id: sessionId,
    subtype: 'success',
    is_error: false,
    result: body,
  })
}

let buffer = ''
let started = false
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk: string) => {
  if (started) return
  buffer += chunk
  if (!buffer.includes('\n')) return
  started = true
  process.stdin.pause()
  void run().catch(() => process.exit(2))
})
