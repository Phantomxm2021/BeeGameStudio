import { spawn } from 'node:child_process'

const scripts = process.argv.slice(2)
if (scripts.length === 0) {
  process.exit(0)
}

const results = await Promise.all(scripts.map(script => new Promise(resolve => {
  const child = spawn(process.execPath, [script], { stdio: 'inherit', shell: false })
  child.once('error', error => {
    console.error(`Failed to start ${script}: ${error.message}`)
    resolve(1)
  })
  child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)))
})))
process.exitCode = results.find(code => code !== 0) ?? 0
