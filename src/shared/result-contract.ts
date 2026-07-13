export type ConnectionErrorCode =
  | 'INVALID_INPUT'
  | 'MCP_BINARY_NOT_FOUND'
  | 'MCP_START_FAILED'
  | 'MCP_CONTRACT_MISMATCH'
  | 'MCP_CALL_FAILED'
  | 'MODEL_NOT_FOUND'
  | 'CANDIDATE_EXPIRED'
  | 'CONNECTION_FAILED'
  | 'SCHEMA_INVALID'
  | 'SNAPSHOT_EXPIRED'
  | 'OPERATION_CANCELLED'
  | 'INTERNAL_ERROR'

export interface ApiError {
  readonly code: ConnectionErrorCode
  readonly message: string
  readonly retryable: boolean
}

export type ApiResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: ApiError }

export function apiSuccess<T>(data: T): ApiResult<T> {
  return { ok: true, data }
}

export function apiFailure<T = never>(error: ApiError): ApiResult<T> {
  return { ok: false, error }
}
