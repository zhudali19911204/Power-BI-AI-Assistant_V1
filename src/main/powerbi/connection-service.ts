import { randomUUID } from 'node:crypto'
import type {
  ConnectionViewState,
  DesktopModelCandidate,
  DisconnectReason
} from '../../shared/connection-contract'
import type { ModelSnapshot } from '../../shared/model-contract'
import type { ApiError, ConnectionErrorCode } from '../../shared/result-contract'
import { ModelRegistry } from './model-registry'
import {
  SchemaReadError,
  type InternalConnectionHandle,
  type InternalDesktopModel,
  type PowerBiReadAdapter
} from './powerbi-read-adapter'
import { buildModelSnapshot, SchemaValidationError } from './schema-service'

const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 3_000

export class ConnectionServiceError extends Error {
  constructor(
    readonly code: ConnectionErrorCode,
    message: string,
    readonly retryable: boolean
  ) {
    super(message)
    this.name = 'ConnectionServiceError'
  }
}

export interface ConnectionServiceOptions {
  readonly healthCheckIntervalMs?: number
  readonly now?: () => Date
  readonly createId?: () => string
}

function initialState(now: () => Date): ConnectionViewState {
  return {
    phase: 'idle',
    candidates: [],
    activeConnection: null,
    disconnectReason: 'initial',
    error: null,
    updatedAt: now().toISOString()
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

export class PowerBiConnectionService {
  private state: ConnectionViewState
  private readonly candidates = new Map<string, InternalDesktopModel>()
  private readonly listeners = new Set<(state: ConnectionViewState) => void>()
  private readonly now: () => Date
  private readonly createId: () => string
  private readonly healthCheckIntervalMs: number
  private operationEpoch = 0
  private operationAbortController: AbortController | null = null
  private activeHandle: InternalConnectionHandle | null = null
  private snapshot: ModelSnapshot | null = null
  private registry: ModelRegistry | null = null
  private healthTimer: ReturnType<typeof setTimeout> | null = null
  private connectionTransitionTail: Promise<void> = Promise.resolve()
  private disposed = false
  private readonly unsubscribeTransport: () => void

  constructor(
    private readonly adapter: PowerBiReadAdapter,
    options: ConnectionServiceOptions = {}
  ) {
    this.now = options.now ?? (() => new Date())
    this.createId = options.createId ?? randomUUID
    this.healthCheckIntervalMs =
      options.healthCheckIntervalMs ?? DEFAULT_HEALTH_CHECK_INTERVAL_MS
    this.state = initialState(this.now)
    this.unsubscribeTransport = this.adapter.onTransportClosed(() => {
      if (!this.disposed) this.invalidate('mcp_stopped')
    })
  }

  getState(): ConnectionViewState {
    return this.state
  }

  getSnapshot(connectionId: string): ModelSnapshot | null {
    if (this.snapshot?.connectionId !== connectionId) return null
    return this.snapshot
  }

  getRegistry(connectionId: string): ModelRegistry | null {
    return this.snapshot?.connectionId === connectionId ? this.registry : null
  }

  subscribe(listener: (state: ConnectionViewState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async discover(): Promise<ConnectionViewState> {
    const previousHandle = this.activeHandle
    const { epoch, signal } = this.beginOperation()
    this.clearHealthTimer()
    this.clearTrustedModel()
    this.candidates.clear()
    this.publish({
      phase: 'discovering',
      candidates: [],
      activeConnection: null,
      disconnectReason: null,
      error: null
    })
    try {
      await this.runConnectionTransition(async () => {
        if (previousHandle) await this.adapter.disconnect(previousHandle)
      })
      if (!this.isCurrent(epoch)) return this.state

      const models = await this.adapter.discoverDesktopModels(signal)
      if (!this.isCurrent(epoch)) return this.state

      const candidates = models.map((model) => {
        const candidateId = this.createId()
        this.candidates.set(candidateId, model)
        return this.toPublicCandidate(candidateId, model)
      })

      if (candidates.length === 0) {
        this.publish({
          phase: 'no_models',
          candidates,
          activeConnection: null,
          disconnectReason: null,
          error: null
        })
        return this.state
      }

      if (candidates.length === 1) {
        return this.connectModel(candidates[0]?.candidateId ?? '')
      }

      this.publish({
        phase: 'selection_required',
        candidates,
        activeConnection: null,
        disconnectReason: null,
        error: null
      })
      return this.state
    } catch (error) {
      if (!this.isCurrent(epoch) || isAbortError(error)) return this.state
      return this.publishFailure('MCP_START_FAILED', '无法启动 Power BI 只读连接服务。', true)
    }
  }

  async connectModel(candidateId: string): Promise<ConnectionViewState> {
    const candidate = this.candidates.get(candidateId)
    if (!candidate) {
      throw new ConnectionServiceError(
        'CANDIDATE_EXPIRED',
        '模型列表已过期，请重新扫描 Power BI Desktop。',
        true
      )
    }

    const previousHandle = this.activeHandle
    const { epoch, signal } = this.beginOperation()
    this.clearHealthTimer()
    this.clearTrustedModel()
    this.publish({
      phase: 'connecting',
      candidates: this.state.candidates,
      activeConnection: null,
      disconnectReason: previousHandle ? 'model_switched' : null,
      error: null
    })
    let handle: InternalConnectionHandle | null = null
    try {
      handle = await this.runConnectionTransition(async () => {
        if (previousHandle) await this.adapter.disconnect(previousHandle)
        if (!this.isCurrent(epoch)) return null

        const nextHandle = await this.adapter.connect(candidate, signal)
        if (!this.isCurrent(epoch)) {
          await this.adapter.disconnect(nextHandle).catch(() => undefined)
          return null
        }
        return nextHandle
      })
      if (!handle || !this.isCurrent(epoch)) return this.state

      const connectionId = this.createId()
      const connectionSessionId = this.createId()
      const connectedAt = this.now().toISOString()
      this.activeHandle = handle
      this.publish({
        phase: 'loading_schema',
        candidates: this.state.candidates,
        activeConnection: {
          connectionId,
          modelName: handle.modelName,
          displayName: handle.displayName,
          connectedAt,
          objectCounts: null
        },
        disconnectReason: null,
        error: null
      })

      const rawModel = await this.adapter.readModel(handle, signal)
      if (!this.isCurrent(epoch)) {
        await this.disconnectHandleSerially(handle)
        return this.state
      }

      const { snapshot, registry } = buildModelSnapshot(rawModel, {
        connectionId,
        connectionSessionId
      })
      this.snapshot = snapshot
      this.registry = registry
      this.publish({
        phase: 'connected',
        candidates: this.state.candidates,
        activeConnection: {
          connectionId,
          modelName: snapshot.modelName,
          displayName: handle.displayName,
          connectedAt,
          objectCounts: snapshot.statistics
        },
        disconnectReason: null,
        error: null
      })
      this.scheduleHealthCheck()
      return this.state
    } catch (error) {
      if (handle) await this.disconnectHandleSerially(handle)
      if (!this.isCurrent(epoch) || isAbortError(error)) return this.state
      this.clearTrustedModel()
      const isSchemaError =
        error instanceof SchemaReadError || error instanceof SchemaValidationError
      return this.publishFailure(
        isSchemaError ? 'SCHEMA_INVALID' : 'CONNECTION_FAILED',
        isSchemaError
          ? 'Power BI 模型结构不完整或无效，请重新打开模型后再试。'
          : '无法读取所选 Power BI 模型，请确认模型仍处于打开状态。',
        true
      )
    }
  }

  async disconnect(): Promise<ConnectionViewState> {
    const handle = this.activeHandle
    this.beginOperation()
    this.clearHealthTimer()
    this.clearTrustedModel()
    this.candidates.clear()
    this.publish({
      phase: 'disconnected',
      candidates: [],
      activeConnection: null,
      disconnectReason: 'user',
      error: null
    })
    void this.runConnectionTransition(async () => {
      if (handle) await this.adapter.disconnect(handle).catch(() => undefined)
    })
    return this.state
  }

  async reconnect(): Promise<ConnectionViewState> {
    this.publish({
      ...this.state,
      phase: 'reconnecting',
      activeConnection: null,
      error: null
    })
    return this.discover()
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    const handle = this.activeHandle
    this.beginOperation()
    this.clearHealthTimer()
    this.clearTrustedModel()
    this.unsubscribeTransport()
    await this.runConnectionTransition(async () => {
      if (handle) await this.adapter.disconnect(handle).catch(() => undefined)
    })
    await this.adapter.dispose()
    this.listeners.clear()
  }

  private beginOperation(): { epoch: number; signal: AbortSignal } {
    this.operationEpoch += 1
    this.operationAbortController?.abort()
    this.operationAbortController = new AbortController()
    return { epoch: this.operationEpoch, signal: this.operationAbortController.signal }
  }

  private isCurrent(epoch: number): boolean {
    return !this.disposed && epoch === this.operationEpoch
  }

  private runConnectionTransition<T>(transition: () => Promise<T>): Promise<T> {
    const result = this.connectionTransitionTail.then(transition)
    this.connectionTransitionTail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private async disconnectHandleSerially(handle: InternalConnectionHandle): Promise<void> {
    await this.runConnectionTransition(() =>
      this.adapter.disconnect(handle).catch(() => undefined)
    )
  }

  private toPublicCandidate(
    candidateId: string,
    model: InternalDesktopModel
  ): DesktopModelCandidate {
    return {
      candidateId,
      displayName: model.displayName,
      modelName: model.modelName,
      source: 'power-bi-desktop',
      disambiguator: model.disambiguator
    }
  }

  private clearTrustedModel(): void {
    this.activeHandle = null
    this.snapshot = null
    this.registry = null
  }

  private invalidate(reason: DisconnectReason): void {
    this.beginOperation()
    this.clearHealthTimer()
    this.clearTrustedModel()
    this.candidates.clear()
    this.publish({
      phase: 'disconnected',
      candidates: [],
      activeConnection: null,
      disconnectReason: reason,
      error: null
    })
  }

  private scheduleHealthCheck(): void {
    if (this.healthCheckIntervalMs <= 0 || !this.activeHandle || this.disposed) return
    this.clearHealthTimer()
    this.healthTimer = setTimeout(() => {
      void this.runHealthCheck()
    }, this.healthCheckIntervalMs)
  }

  private async runHealthCheck(): Promise<void> {
    const handle = this.activeHandle
    if (!handle || this.disposed || this.state.phase !== 'connected') return
    try {
      const models = await this.adapter.discoverDesktopModels()
      if (!this.activeHandle || this.activeHandle !== handle) return
      if (!models.some((model) => model.fingerprint === handle.instanceFingerprint)) {
        this.invalidate('model_closed')
        return
      }
    } catch {
      // A transient health-check failure does not revive or replace the current snapshot.
    }
    this.scheduleHealthCheck()
  }

  private clearHealthTimer(): void {
    if (this.healthTimer) clearTimeout(this.healthTimer)
    this.healthTimer = null
  }

  private publish(
    state: Omit<ConnectionViewState, 'updatedAt'> | ConnectionViewState
  ): ConnectionViewState {
    this.state = { ...state, updatedAt: this.now().toISOString() }
    for (const listener of this.listeners) listener(this.state)
    return this.state
  }

  private publishFailure(
    code: ConnectionErrorCode,
    message: string,
    retryable: boolean
  ): ConnectionViewState {
    return this.publish({
      phase: 'error',
      candidates: this.state.candidates,
      activeConnection: null,
      disconnectReason: 'connection_failed',
      error: { code, message, retryable }
    })
  }
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ConnectionServiceError) {
    return { code: error.code, message: error.message, retryable: error.retryable }
  }
  return {
    code: 'INTERNAL_ERROR',
    message: '本地连接服务发生错误，请重试。',
    retryable: true
  }
}
