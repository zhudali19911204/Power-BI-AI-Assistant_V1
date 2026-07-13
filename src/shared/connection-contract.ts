import type { ModelObjectCounts, ModelSnapshot } from './model-contract'
import type { ApiResult, ConnectionErrorCode } from './result-contract'

export const CONNECTION_LIST_CHANNEL = 'connection:list' as const
export const CONNECTION_CONNECT_CHANNEL = 'connection:connect' as const
export const CONNECTION_DISCONNECT_CHANNEL = 'connection:disconnect' as const
export const CONNECTION_RECONNECT_CHANNEL = 'connection:reconnect' as const
export const CONNECTION_STATE_CHANNEL = 'connection:state' as const
export const CONNECTION_STATE_CHANGED_CHANNEL = 'connection:state-changed' as const
export const SCHEMA_SNAPSHOT_CHANNEL = 'schema:snapshot' as const

export type ConnectionPhase =
  | 'idle'
  | 'discovering'
  | 'no_models'
  | 'selection_required'
  | 'connecting'
  | 'loading_schema'
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'error'

export type DisconnectReason =
  | 'initial'
  | 'user'
  | 'model_closed'
  | 'model_switched'
  | 'mcp_stopped'
  | 'connection_failed'

export interface DesktopModelCandidate {
  readonly candidateId: string
  readonly displayName: string
  readonly modelName: string | null
  readonly source: 'power-bi-desktop'
  readonly disambiguator: string | null
}

export interface ActiveModelConnection {
  readonly connectionId: string
  readonly modelName: string
  readonly displayName: string
  readonly connectedAt: string
  readonly objectCounts: ModelObjectCounts | null
}

export interface ConnectionViewError {
  readonly code: ConnectionErrorCode
  readonly message: string
  readonly retryable: boolean
}

export interface ConnectionViewState {
  readonly phase: ConnectionPhase
  readonly candidates: readonly DesktopModelCandidate[]
  readonly activeConnection: ActiveModelConnection | null
  readonly disconnectReason: DisconnectReason | null
  readonly error: ConnectionViewError | null
  readonly updatedAt: string
}

export interface ConnectModelInput {
  readonly candidateId: string
}

export interface SnapshotInput {
  readonly connectionId: string
}

export interface ConnectionApi {
  listModels: () => Promise<ApiResult<ConnectionViewState>>
  connectModel: (input: ConnectModelInput) => Promise<ApiResult<ConnectionViewState>>
  disconnectModel: () => Promise<ApiResult<ConnectionViewState>>
  reconnectModel: () => Promise<ApiResult<ConnectionViewState>>
  getConnectionState: () => Promise<ApiResult<ConnectionViewState>>
  getModelSnapshot: (input: SnapshotInput) => Promise<ApiResult<ModelSnapshot | null>>
  onConnectionStateChanged: (listener: (state: ConnectionViewState) => void) => () => void
}
