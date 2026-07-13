import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderService } from '../../src/main/provider/provider-service'

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

import {
  PROVIDER_ACTIVATE_CHANNEL,
  PROVIDER_DELETE_CHANNEL,
  PROVIDER_LIST_CHANNEL,
  PROVIDER_SAVE_CHANNEL,
  PROVIDER_TEST_CANCEL_CHANNEL,
  PROVIDER_TEST_EVENT_CHANNEL,
  PROVIDER_TEST_START_CHANNEL
} from '../../src/shared/provider-contract'
import { registerProviderIpc } from '../../src/main/ipc/register-provider-ipc'

function createMainWindow() {
  const send = vi.fn()
  const mainFrame = {}
  const webContents = {
    id: 42,
    mainFrame,
    isDestroyed: () => false,
    send
  }
  return {
    window: {
      isDestroyed: () => false,
      webContents
    } as unknown as Electron.BrowserWindow,
    event: {
      sender: webContents,
      senderFrame: mainFrame
    } as unknown as Electron.IpcMainInvokeEvent,
    send
  }
}

function createService() {
  const state = { revision: 0, profiles: [] }
  const startTest = vi.fn(async (_owner, _draft, sink) => {
    sink({ testId: '22222222-2222-4222-8222-222222222222', sequence: 1, type: 'started' })
    return { testId: '22222222-2222-4222-8222-222222222222' }
  })
  return {
    service: {
      list: vi.fn(async () => state),
      startTest,
      cancel: vi.fn(() => ({ cancelled: true })),
      save: vi.fn(async () => state),
      delete: vi.fn(async () => state),
      activate: vi.fn(async () => state)
    } as unknown as ProviderService,
    startTest
  }
}

describe('Provider IPC boundary', () => {
  beforeEach(() => {
    electron.handlers.clear()
    electron.removeHandler.mockClear()
  })

  it('registers only fixed Provider operations and unregisters them', () => {
    const fake = createService()
    const main = createMainWindow()
    const unregister = registerProviderIpc(fake.service, () => main.window)
    expect([...electron.handlers.keys()].sort()).toEqual(
      [
        PROVIDER_LIST_CHANNEL,
        PROVIDER_TEST_START_CHANNEL,
        PROVIDER_TEST_CANCEL_CHANNEL,
        PROVIDER_SAVE_CHANNEL,
        PROVIDER_DELETE_CHANNEL,
        PROVIDER_ACTIVATE_CHANNEL
      ].sort()
    )
    unregister()
    expect(electron.handlers).toHaveLength(0)
    expect(electron.removeHandler).toHaveBeenCalledTimes(6)
  })

  it('rejects untrusted frames before service invocation', async () => {
    const fake = createService()
    const main = createMainWindow()
    registerProviderIpc(fake.service, () => main.window)
    const untrusted = {
      ...main.event,
      senderFrame: {}
    } as Electron.IpcMainInvokeEvent
    const result = await electron.handlers.get(PROVIDER_LIST_CHANNEL)?.(untrusted)
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN_IPC_SENDER', retryable: false }
    })
    expect((fake.service.list as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })

  it('validates the draft strictly and forwards only sanitized test events', async () => {
    const fake = createService()
    const main = createMainWindow()
    registerProviderIpc(fake.service, () => main.window)
    const start = electron.handlers.get(PROVIDER_TEST_START_CHANNEL)
    const validDraft = {
      displayName: 'Provider A',
      chatCompletionsUrl: 'https://api.example.com/v1/chat/completions',
      model: 'model-a',
      maxContextTokens: 8192,
      apiKey: 'secret'
    }

    await expect(start?.(main.event, { ...validDraft, messages: [] })).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' }
    })
    expect(fake.startTest).not.toHaveBeenCalled()

    await expect(start?.(main.event, validDraft)).resolves.toMatchObject({ ok: true })
    expect(fake.startTest).toHaveBeenCalledWith(42, validDraft, expect.any(Function))
    expect(main.send).toHaveBeenCalledWith(PROVIDER_TEST_EVENT_CHANNEL, {
      testId: '22222222-2222-4222-8222-222222222222',
      sequence: 1,
      type: 'started'
    })
  })
})
