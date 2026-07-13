import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionViewState } from '../../src/shared/connection-contract'
import type { PowerBiConnectionService } from '../../src/main/powerbi/connection-service'

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
  CONNECTION_CONNECT_CHANNEL,
  CONNECTION_DISCONNECT_CHANNEL,
  CONNECTION_LIST_CHANNEL,
  CONNECTION_RECONNECT_CHANNEL,
  CONNECTION_STATE_CHANGED_CHANNEL,
  CONNECTION_STATE_CHANNEL,
  SCHEMA_SNAPSHOT_CHANNEL
} from '../../src/shared/connection-contract'
import { registerConnectionIpc } from '../../src/main/ipc/register-connection-ipc'

const state: ConnectionViewState = {
  phase: 'no_models',
  candidates: [],
  activeConnection: null,
  disconnectReason: null,
  error: null,
  updatedAt: '2026-07-13T08:00:00.000Z'
}

function createMainWindow(send = vi.fn()): {
  readonly window: Electron.BrowserWindow
  readonly event: Electron.IpcMainInvokeEvent
  readonly send: ReturnType<typeof vi.fn>
} {
  const mainFrame = {}
  const webContents = {
    mainFrame,
    isDestroyed: () => false,
    send
  }
  const window = {
    isDestroyed: () => false,
    webContents
  } as unknown as Electron.BrowserWindow
  const event = {
    sender: webContents,
    senderFrame: mainFrame
  } as unknown as Electron.IpcMainInvokeEvent
  return { window, event, send }
}

function createService(): {
  readonly service: PowerBiConnectionService
  readonly connectModel: ReturnType<typeof vi.fn>
  readonly getSnapshot: ReturnType<typeof vi.fn>
  readonly discover: ReturnType<typeof vi.fn>
  emit: (nextState: ConnectionViewState) => void
  readonly unsubscribe: ReturnType<typeof vi.fn>
} {
  let stateListener: ((nextState: ConnectionViewState) => void) | null = null
  const connectModel = vi.fn(async () => state)
  const getSnapshot = vi.fn(() => null)
  const discover = vi.fn(async () => state)
  const unsubscribe = vi.fn()
  const service = {
    discover,
    connectModel,
    disconnect: vi.fn(async () => state),
    reconnect: vi.fn(async () => state),
    getState: vi.fn(() => state),
    getSnapshot,
    subscribe: vi.fn((listener: (nextState: ConnectionViewState) => void) => {
      stateListener = listener
      return unsubscribe
    })
  } as unknown as PowerBiConnectionService

  return {
    service,
    connectModel,
    getSnapshot,
    discover,
    emit: (nextState) => stateListener?.(nextState),
    unsubscribe
  }
}

describe('connection IPC security boundary', () => {
  beforeEach(() => {
    electron.handlers.clear()
    electron.removeHandler.mockClear()
  })

  it('registers only the explicit phase 1 channels and unregisters all of them', () => {
    const fake = createService()
    const main = createMainWindow()
    const unregister = registerConnectionIpc(fake.service, () => main.window)

    expect([...electron.handlers.keys()].sort()).toEqual(
      [
        CONNECTION_LIST_CHANNEL,
        CONNECTION_CONNECT_CHANNEL,
        CONNECTION_DISCONNECT_CHANNEL,
        CONNECTION_RECONNECT_CHANNEL,
        CONNECTION_STATE_CHANNEL,
        SCHEMA_SNAPSHOT_CHANNEL
      ].sort()
    )

    unregister()

    expect(fake.unsubscribe).toHaveBeenCalledOnce()
    expect(electron.handlers).toHaveLength(0)
    expect(electron.removeHandler).toHaveBeenCalledTimes(6)
  })

  it('rejects malformed UUIDs and extra fields before calling the service', async () => {
    const fake = createService()
    const main = createMainWindow()
    registerConnectionIpc(fake.service, () => main.window)
    const connect = electron.handlers.get(CONNECTION_CONNECT_CHANNEL)
    const snapshot = electron.handlers.get(SCHEMA_SNAPSHOT_CHANNEL)

    await expect(connect?.(main.event, { candidateId: 'not-a-uuid' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' }
    })
    await expect(
      connect?.(main.event, {
        candidateId: 'bd62de59-5baf-4ddd-b899-47ad7a1191a4',
        operation: 'Create'
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    await expect(snapshot?.(main.event, { connectionId: 42 })).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' }
    })
    expect(fake.connectModel).not.toHaveBeenCalled()
    expect(fake.getSnapshot).not.toHaveBeenCalled()
  })

  it('passes only validated opaque identifiers and sanitizes unexpected errors', async () => {
    const fake = createService()
    fake.discover.mockRejectedValueOnce(new Error('C:\\Users\\name\\secret.pbix'))
    const main = createMainWindow()
    registerConnectionIpc(fake.service, () => main.window)
    const candidateId = 'bd62de59-5baf-4ddd-b899-47ad7a1191a4'
    const connectionId = '106fa1cb-6d52-43c0-8774-3ba58a10a32c'

    await expect(
      electron.handlers.get(CONNECTION_CONNECT_CHANNEL)?.(main.event, { candidateId })
    ).resolves.toMatchObject({ ok: true })
    await expect(
      electron.handlers.get(SCHEMA_SNAPSHOT_CHANNEL)?.(main.event, { connectionId })
    ).resolves.toMatchObject({ ok: true, data: null })
    await expect(electron.handlers.get(CONNECTION_LIST_CHANNEL)?.(main.event)).resolves.toEqual({
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: '本地连接服务发生错误，请重试。',
        retryable: true
      }
    })

    expect(fake.connectModel).toHaveBeenCalledWith(candidateId)
    expect(fake.getSnapshot).toHaveBeenCalledWith(connectionId)
  })

  it('rejects other windows and subframes before calling a service', async () => {
    const fake = createService()
    const main = createMainWindow()
    registerConnectionIpc(fake.service, () => main.window)

    await expect(
      electron.handlers.get(CONNECTION_LIST_CHANNEL)?.({
        sender: main.event.sender,
        senderFrame: {}
      })
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'FORBIDDEN_IPC_SENDER',
        message: 'IPC 请求来源无效。',
        retryable: false
      }
    })
    await expect(
      electron.handlers.get(CONNECTION_LIST_CHANNEL)?.({
        sender: {},
        senderFrame: main.event.senderFrame
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN_IPC_SENDER' }
    })
    expect(fake.discover).not.toHaveBeenCalled()
  })

  it('pushes state only to the trusted live main window', () => {
    const send = vi.fn()
    const main = createMainWindow(send)
    const fake = createService()
    registerConnectionIpc(fake.service, () => main.window)

    fake.emit(state)

    expect(send).toHaveBeenCalledWith(CONNECTION_STATE_CHANGED_CHANNEL, state)
  })
})
