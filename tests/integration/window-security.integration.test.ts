import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createWindowOptions } from '../../src/main/window'

describe('Electron main-to-renderer security boundary', () => {
  it('enables context isolation and disables Node.js in the renderer', () => {
    const preloadPath = resolve('out/preload/index.js')
    const options = createWindowOptions(preloadPath)

    expect(options.webPreferences).toMatchObject({
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    })
  })

  it('keeps the smoke-test window hidden', () => {
    const options = createWindowOptions(resolve('out/preload/index.js'), true)

    expect(options.show).toBe(false)
  })
})
