import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { AssistantApi } from '../../src/shared/app-contract'
import type { ConnectionViewState } from '../../src/shared/connection-contract'

const electron = vi.hoisted(() => ({
  exposedName: null as string | null,
  exposedApi: null as AssistantApi | null,
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn()
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (name: string, api: AssistantApi) => {
      electron.exposedName = name
      electron.exposedApi = api
    }
  },
  ipcRenderer: {
    invoke: electron.invoke,
    on: electron.on,
    removeListener: electron.removeListener
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
import { APP_INFO_CHANNEL } from '../../src/shared/app-contract'

const state: ConnectionViewState = {
  phase: 'connected',
  candidates: [],
  activeConnection: null,
  disconnectReason: null,
  error: null,
  updatedAt: '2026-07-13T08:00:00.000Z'
}

describe('preload AssistantApi boundary', () => {
  beforeAll(async () => {
    await import('../../src/preload/index')
  })

  it('exposes a frozen, explicit API without generic Electron primitives', () => {
    expect(electron.exposedName).toBe('powerBiAssistant')
    expect(electron.exposedApi).not.toBeNull()
    expect(Object.isFrozen(electron.exposedApi)).toBe(true)
    expect(Object.keys(electron.exposedApi ?? {}).sort()).toEqual(
      [
        'getAppInfo',
        'listModels',
        'connectModel',
        'disconnectModel',
        'reconnectModel',
        'getConnectionState',
        'getModelSnapshot',
        'onConnectionStateChanged'
      ].sort()
    )
    expect(electron.exposedApi).not.toHaveProperty('ipcRenderer')
    expect(electron.exposedApi).not.toHaveProperty('invoke')
  })

  it('maps every method to its fixed channel', async () => {
    electron.invoke.mockResolvedValue({ ok: true, data: state })
    const api = electron.exposedApi
    if (!api) throw new Error('Preload API was not exposed.')
    const candidate = { candidateId: 'bd62de59-5baf-4ddd-b899-47ad7a1191a4' }
    const snapshot = { connectionId: '106fa1cb-6d52-43c0-8774-3ba58a10a32c' }

    await api.getAppInfo()
    await api.listModels()
    await api.connectModel(candidate)
    await api.disconnectModel()
    await api.reconnectModel()
    await api.getConnectionState()
    await api.getModelSnapshot(snapshot)

    expect(electron.invoke.mock.calls).toEqual([
      [APP_INFO_CHANNEL],
      [CONNECTION_LIST_CHANNEL],
      [CONNECTION_CONNECT_CHANNEL, candidate],
      [CONNECTION_DISCONNECT_CHANNEL],
      [CONNECTION_RECONNECT_CHANNEL],
      [CONNECTION_STATE_CHANNEL],
      [SCHEMA_SNAPSHOT_CHANNEL, snapshot]
    ])
  })

  it('removes the exact state listener and forwards only the state payload', () => {
    const api = electron.exposedApi
    if (!api) throw new Error('Preload API was not exposed.')
    const listener = vi.fn()
    const unsubscribe = api.onConnectionStateChanged(listener)
    const registered = electron.on.mock.calls.at(-1)
    const handler = registered?.[1] as
      | ((event: unknown, nextState: ConnectionViewState) => void)
      | undefined

    handler?.({ sender: 'must-not-cross-context-bridge' }, state)
    unsubscribe()

    expect(registered?.[0]).toBe(CONNECTION_STATE_CHANGED_CHANNEL)
    expect(listener).toHaveBeenCalledWith(state)
    expect(electron.removeListener).toHaveBeenCalledWith(
      CONNECTION_STATE_CHANGED_CHANNEL,
      handler
    )
  })
})
