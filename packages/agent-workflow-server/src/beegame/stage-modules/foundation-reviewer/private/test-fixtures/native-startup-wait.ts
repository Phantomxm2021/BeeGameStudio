import { emitNativeDiagnostic } from '@bee-game-studio/agent-workflow/native-diagnostics'
emitNativeDiagnostic({ event: 'cli_entry' })
process.stdin.resume()
setInterval(() => {}, 1000)
