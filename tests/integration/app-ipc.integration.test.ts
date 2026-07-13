import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  removeHandler: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      electron.handlers.set(channel, handler)
    },
    removeHandler: (channel: string) => {
      electron.removeHandler(channel)
      electron.handlers.delete(channel)
    }
  }
}))

import { APP_INFO_CHANNEL, createAppInfo } from '../../src/shared/app-contract'
import { IpcSenderRejectedError } from '../../src/main/ipc/ipc-sender-policy'
import { registerAppIpc } from '../../src/main/ipc/register-app-ipc'

function createMainWindow(): {
  readonly window: Electron.BrowserWindow
  readonly event: Electron.IpcMainInvokeEvent
} {
  const mainFrame = {}
  const webContents = {
    mainFrame,
    isDestroyed: () => false
  }
  return {
    window: {
      isDestroyed: () => false,
      webContents
    } as unknown as Electron.BrowserWindow,
    event: {
      sender: webContents,
      senderFrame: mainFrame
    } as unknown as Electron.IpcMainInvokeEvent
  }
}

describe('app IPC security boundary', () => {
  beforeEach(() => {
    electron.handlers.clear()
    electron.removeHandler.mockClear()
  })

  it('returns app information only to the trusted main frame', () => {
    const main = createMainWindow()
    const unregister = registerAppIpc(() => main.window, () => '9.9.9')
    const handler = electron.handlers.get(APP_INFO_CHANNEL)

    expect(handler?.(main.event)).toEqual(createAppInfo('9.9.9'))
    expect(() => handler?.({ sender: {}, senderFrame: {} })).toThrow(
      IpcSenderRejectedError
    )

    unregister()
    expect(electron.handlers.has(APP_INFO_CHANNEL)).toBe(false)
    expect(electron.removeHandler).toHaveBeenCalledWith(APP_INFO_CHANNEL)
  })
})
