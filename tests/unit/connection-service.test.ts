import { describe, expect, it, vi } from 'vitest'
import {
  ConnectionServiceError,
  PowerBiConnectionService,
  toApiError
} from '../../src/main/powerbi/connection-service'
import type {
  InternalConnectionHandle,
  InternalDesktopModel,
  PowerBiReadAdapter,
  RawModelRead
} from '../../src/main/powerbi/powerbi-read-adapter'
import { SchemaReadError } from '../../src/main/powerbi/powerbi-read-adapter'
import {
  createConnectionHandle,
  createDesktopModel,
  createRawModelRead
} from '../fixtures/model-fixtures'

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

class FakePowerBiReadAdapter implements PowerBiReadAdapter {
  models: readonly InternalDesktopModel[] = []
  rawModel: RawModelRead = createRawModelRead()
  handle: InternalConnectionHandle = createConnectionHandle()
  discoverImpl: PowerBiReadAdapter['discoverDesktopModels'] = async () => this.models
  connectImpl: PowerBiReadAdapter['connect'] = async () => this.handle
  readModelImpl: PowerBiReadAdapter['readModel'] = async () => this.rawModel
  disconnectImpl: PowerBiReadAdapter['disconnect'] = async () => undefined
  readonly discoverSignals: (AbortSignal | undefined)[] = []
  readonly connectSignals: (AbortSignal | undefined)[] = []
  readonly disconnectedHandles: InternalConnectionHandle[] = []
  disposed = false
  private readonly transportListeners = new Set<() => void>()

  discoverDesktopModels(signal?: AbortSignal): Promise<readonly InternalDesktopModel[]> {
    this.discoverSignals.push(signal)
    return this.discoverImpl(signal)
  }

  connect(
    model: InternalDesktopModel,
    signal?: AbortSignal
  ): Promise<InternalConnectionHandle> {
    this.connectSignals.push(signal)
    return this.connectImpl(model, signal)
  }

  readModel(handle: InternalConnectionHandle, signal?: AbortSignal): Promise<RawModelRead> {
    return this.readModelImpl(handle, signal)
  }

  async disconnect(handle: InternalConnectionHandle): Promise<void> {
    this.disconnectedHandles.push(handle)
    await this.disconnectImpl(handle)
  }

  onTransportClosed(listener: () => void): () => void {
    this.transportListeners.add(listener)
    return () => this.transportListeners.delete(listener)
  }

  emitTransportClosed(): void {
    for (const listener of this.transportListeners) listener()
  }

  async dispose(): Promise<void> {
    this.disposed = true
  }
}

function createIdFactory(...ids: string[]): () => string {
  let index = 0
  return () => ids[index++] ?? `generated-${index}`
}

function createService(
  adapter: FakePowerBiReadAdapter,
  ...ids: string[]
): PowerBiConnectionService {
  return new PowerBiConnectionService(adapter, {
    healthCheckIntervalMs: 0,
    now: () => new Date('2026-07-13T08:00:00.000Z'),
    createId: createIdFactory(...ids)
  })
}

describe('PowerBiConnectionService', () => {
  it('auto-connects one model and publishes the complete state sequence', async () => {
    const adapter = new FakePowerBiReadAdapter()
    adapter.models = [createDesktopModel()]
    const service = createService(
      adapter,
      'candidate-1',
      'connection-1',
      'session-1'
    )
    const phases: string[] = []
    service.subscribe((state) => phases.push(state.phase))

    const state = await service.discover()

    expect(phases).toEqual(['discovering', 'connecting', 'loading_schema', 'connected'])
    expect(state).toMatchObject({
      phase: 'connected',
      activeConnection: {
        connectionId: 'connection-1',
        modelName: '销售模型',
        objectCounts: { tables: 2, columns: 3, measures: 1, relationships: 1 }
      },
      disconnectReason: null,
      error: null,
      updatedAt: '2026-07-13T08:00:00.000Z'
    })
    expect(service.getSnapshot('connection-1')?.connectionSessionId).toBe('session-1')
    expect(service.getSnapshot('wrong-connection')).toBeNull()
    expect(service.getRegistry('connection-1')?.resolveMeasure('总销售额')).toBeDefined()

    await service.dispose()
  })

  it('shows selection for multiple models and rejects an expired candidate id', async () => {
    const adapter = new FakePowerBiReadAdapter()
    adapter.models = [
      createDesktopModel(),
      createDesktopModel({ fingerprint: 'desktop-model-b', displayName: '库存.pbix' })
    ]
    const service = createService(adapter, 'candidate-a', 'candidate-b')

    const state = await service.discover()

    expect(state.phase).toBe('selection_required')
    expect(state.candidates.map((candidate) => candidate.candidateId)).toEqual([
      'candidate-a',
      'candidate-b'
    ])
    await expect(service.connectModel('stale-candidate')).rejects.toMatchObject({
      name: 'ConnectionServiceError',
      code: 'CANDIDATE_EXPIRED',
      retryable: true
    })
    expect(service.getState().phase).toBe('selection_required')

    await service.dispose()
  })

  it('ignores a stale discovery result and aborts its signal', async () => {
    const adapter = new FakePowerBiReadAdapter()
    const first = deferred<readonly InternalDesktopModel[]>()
    const second = deferred<readonly InternalDesktopModel[]>()
    let call = 0
    adapter.discoverImpl = async () => (call++ === 0 ? first.promise : second.promise)
    const service = createService(adapter, 'candidate-a', 'candidate-b')

    const firstDiscovery = service.discover()
    await vi.waitFor(() => expect(adapter.discoverSignals).toHaveLength(1))
    const secondDiscovery = service.discover()
    expect(adapter.discoverSignals[0]?.aborted).toBe(true)

    second.resolve([
      createDesktopModel(),
      createDesktopModel({ fingerprint: 'desktop-model-b', displayName: '库存.pbix' })
    ])
    await secondDiscovery
    first.resolve([])
    await firstDiscovery

    expect(service.getState().phase).toBe('selection_required')
    expect(service.getState().candidates).toHaveLength(2)

    await service.dispose()
  })

  it('cannot be revived by a connection that finishes after user disconnect', async () => {
    const adapter = new FakePowerBiReadAdapter()
    adapter.models = [
      createDesktopModel(),
      createDesktopModel({ fingerprint: 'desktop-model-b', displayName: '库存.pbix' })
    ]
    const pendingHandle = deferred<InternalConnectionHandle>()
    adapter.connectImpl = async () => pendingHandle.promise
    const service = createService(adapter, 'candidate-a', 'candidate-b')
    const candidates = await service.discover()

    const pendingConnection = service.connectModel(candidates.candidates[0]!.candidateId)
    expect(service.getState().phase).toBe('connecting')
    await vi.waitFor(() => expect(adapter.connectSignals).toHaveLength(1))
    await service.disconnect()
    expect(adapter.connectSignals[0]?.aborted).toBe(true)

    const lateHandle = createConnectionHandle()
    pendingHandle.resolve(lateHandle)
    await pendingConnection

    expect(service.getState()).toMatchObject({
      phase: 'disconnected',
      activeConnection: null,
      disconnectReason: 'user'
    })
    expect(service.getSnapshot('connection-1')).toBeNull()
    expect(adapter.disconnectedHandles).toContain(lateHandle)

    await service.dispose()
  })

  it('serializes the previous disconnect before connecting a switched model', async () => {
    const adapter = new FakePowerBiReadAdapter()
    const firstModel = createDesktopModel()
    const secondModel = createDesktopModel({
      fingerprint: 'desktop-model-b',
      displayName: '库存.pbix',
      modelName: '库存模型'
    })
    adapter.models = [firstModel, secondModel]
    const events: string[] = []
    adapter.connectImpl = async (model) => {
      events.push(`connect:${model.fingerprint}`)
      return createConnectionHandle({
        connectionName: `connection:${model.fingerprint}`,
        instanceFingerprint: model.fingerprint,
        displayName: model.displayName,
        modelName: model.modelName ?? model.displayName
      })
    }
    const service = createService(
      adapter,
      'candidate-a',
      'candidate-b',
      'connection-a',
      'session-a',
      'connection-b',
      'session-b'
    )
    const selection = await service.discover()
    await service.connectModel(selection.candidates[0]!.candidateId)

    events.length = 0
    const disconnectStarted = deferred<void>()
    const allowDisconnect = deferred<void>()
    adapter.disconnectImpl = async () => {
      events.push('disconnect:start')
      disconnectStarted.resolve(undefined)
      await allowDisconnect.promise
      events.push('disconnect:end')
    }

    const switching = service.connectModel(selection.candidates[1]!.candidateId)
    await disconnectStarted.promise
    expect(events).toEqual(['disconnect:start'])

    allowDisconnect.resolve(undefined)
    const switched = await switching

    expect(events).toEqual([
      'disconnect:start',
      'disconnect:end',
      'connect:desktop-model-b'
    ])
    expect(switched).toMatchObject({
      phase: 'connected',
      activeConnection: { displayName: '库存.pbix' }
    })

    await service.dispose()
  })

  it('invalidates snapshot and registry immediately on disconnect or MCP closure', async () => {
    const adapter = new FakePowerBiReadAdapter()
    adapter.models = [createDesktopModel()]
    const service = createService(
      adapter,
      'candidate-1',
      'connection-1',
      'session-1'
    )
    await service.discover()
    expect(service.getSnapshot('connection-1')).not.toBeNull()

    adapter.emitTransportClosed()

    expect(service.getState()).toMatchObject({
      phase: 'disconnected',
      activeConnection: null,
      disconnectReason: 'mcp_stopped'
    })
    expect(service.getSnapshot('connection-1')).toBeNull()
    expect(service.getRegistry('connection-1')).toBeNull()

    await service.dispose()

    const userAdapter = new FakePowerBiReadAdapter()
    userAdapter.models = [createDesktopModel()]
    const userService = createService(
      userAdapter,
      'candidate-2',
      'connection-2',
      'session-2'
    )
    await userService.discover()
    await userService.disconnect()

    expect(userService.getSnapshot('connection-2')).toBeNull()
    expect(userService.getRegistry('connection-2')).toBeNull()
    expect(userService.getState().disconnectReason).toBe('user')
    expect(userAdapter.disconnectedHandles).toHaveLength(1)

    await userService.dispose()
  })

  it('maps known service errors without exposing arbitrary internal errors', () => {
    expect(
      toApiError(new ConnectionServiceError('CANDIDATE_EXPIRED', 'expired', true))
    ).toEqual({ code: 'CANDIDATE_EXPIRED', message: 'expired', retryable: true })
    expect(toApiError(new Error('secret path C:\\Users\\name'))).toEqual({
      code: 'INTERNAL_ERROR',
      message: '本地连接服务发生错误，请重试。',
      retryable: true
    })
  })

  it.each([
    ['registry validation', () => {
      const raw = createRawModelRead()
      return { ...raw, tables: [...raw.tables, raw.tables[0]!] }
    }],
    ['adapter completeness validation', () => new SchemaReadError('truncated schema')]
  ])('maps %s failures to SCHEMA_INVALID', async (_, failure) => {
    const adapter = new FakePowerBiReadAdapter()
    adapter.models = [createDesktopModel()]
    const value = failure()
    if (value instanceof Error) {
      adapter.readModelImpl = async () => {
        throw value
      }
    } else {
      adapter.rawModel = value
    }
    const service = createService(
      adapter,
      'candidate-1',
      'connection-1',
      'session-1'
    )

    const state = await service.discover()

    expect(state).toMatchObject({
      phase: 'error',
      error: { code: 'SCHEMA_INVALID' }
    })
    await service.dispose()
  })
})
