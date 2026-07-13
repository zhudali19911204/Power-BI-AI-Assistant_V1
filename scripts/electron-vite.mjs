import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const command = process.argv[2]
const supportedCommands = new Set(['dev', 'preview'])

if (!command || !supportedCommands.has(command)) {
  throw new Error('Expected one of: dev, preview')
}

const electronEnvironment = { ...process.env }

// Prevent parent IDEs based on Electron from forcing the child app into Node.js mode.
delete electronEnvironment.ELECTRON_RUN_AS_NODE

const child = spawn(
  process.execPath,
  [resolve('node_modules/electron-vite/bin/electron-vite.js'), command],
  {
    env: electronEnvironment,
    stdio: 'inherit'
  }
)

child.once('error', (error) => {
  throw error
})

child.once('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 1)
})
