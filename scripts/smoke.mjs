import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const electronEnvironment = { ...process.env }

// Some IDE terminals set this globally, which would make Electron behave as plain Node.js.
delete electronEnvironment.ELECTRON_RUN_AS_NODE
electronEnvironment.PBI_ASSISTANT_SMOKE_TEST = '1'

const result = spawnSync(electronPath, [resolve('.')], {
  env: electronEnvironment,
  stdio: 'inherit'
})

if (result.error) {
  throw result.error
}

process.exit(result.status ?? 1)
