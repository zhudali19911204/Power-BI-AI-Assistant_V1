export const PROVIDER_LIST_CHANNEL = 'provider:list' as const
export const PROVIDER_TEST_START_CHANNEL = 'provider:test-start' as const
export const PROVIDER_TEST_CANCEL_CHANNEL = 'provider:test-cancel' as const
export const PROVIDER_TEST_EVENT_CHANNEL = 'provider:test-event' as const
export const PROVIDER_SAVE_CHANNEL = 'provider:save-tested' as const
export const PROVIDER_DELETE_CHANNEL = 'provider:delete' as const
export const PROVIDER_ACTIVATE_CHANNEL = 'provider:activate' as const

export type ProviderErrorCode =
  | 'INVALID_INPUT'
  | 'FORBIDDEN_IPC_SENDER'
  | 'UNSAFE_PROVIDER_URL'
  | 'PRIVATE_ADDRESS_BLOCKED'
  | 'PROVIDER_REDIRECT_BLOCKED'
  | 'SECRET_STORAGE_UNAVAILABLE'
  | 'SECRET_DECRYPT_FAILED'
  | 'PROFILE_NOT_FOUND'
  | 'TEST_RECEIPT_EXPIRED'
  | 'AUTH_FAILED'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_REQUEST_REJECTED'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'RESPONSE_TOO_LARGE'
  | 'MALFORMED_RESPONSE'
  | 'MALFORMED_STREAM'
  | 'NETWORK_ERROR'
  | 'CONFIG_CORRUPT'
  | 'INTERNAL_ERROR'

export interface ProviderError {
  readonly code: ProviderErrorCode
  readonly message: string
  readonly retryable: boolean
}

export type ProviderResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: ProviderError }

export interface ProviderCapabilities {
  readonly supportsStreaming: boolean
  readonly supportsJsonMode: boolean
}

export interface ProviderProfileView extends ProviderCapabilities {
  readonly id: string
  readonly displayName: string
  readonly chatCompletionsUrl: string
  readonly model: string
  readonly maxContextTokens: number
  readonly hasSecret: true
  readonly isActive: boolean
  readonly updatedAt: string
}

export interface ProviderProfilesState {
  readonly revision: number
  readonly profiles: readonly ProviderProfileView[]
}

export interface ProviderTestDraft {
  readonly profileId?: string
  readonly displayName: string
  readonly chatCompletionsUrl: string
  readonly model: string
  readonly maxContextTokens: number
  /** 留空时仅允许复用已保存配置的密钥。该字段永不从 Main 返回。 */
  readonly apiKey?: string
}

export interface ProviderTestStarted {
  readonly testId: string
}

export interface ProviderTestReceipt {
  readonly receiptId: string
  readonly expiresAt: string
}

export interface ProviderTestEventBase {
  readonly testId: string
  readonly sequence: number
}

export type ProviderTestEvent =
  | (ProviderTestEventBase & { readonly type: 'started' })
  | (ProviderTestEventBase & {
      readonly type: 'retry_wait'
      readonly attempt: number
      readonly waitMs: number
    })
  | (ProviderTestEventBase & { readonly type: 'chunk'; readonly delta: string })
  | (ProviderTestEventBase & {
      readonly type: 'capability'
      readonly capability: 'streaming' | 'json_mode'
      readonly supported: boolean
    })
  | (ProviderTestEventBase & {
      readonly type: 'completed'
      readonly output: string
      readonly capabilities: ProviderCapabilities
      readonly receipt: ProviderTestReceipt
    })
  | (ProviderTestEventBase & {
      readonly type: 'cancelled'
      readonly output: string
    })
  | (ProviderTestEventBase & { readonly type: 'failed'; readonly error: ProviderError })

export interface ProviderTestCancelInput {
  readonly testId: string
}

export interface ProviderSaveInput {
  readonly receiptId: string
}

export interface ProviderProfileInput {
  readonly profileId: string
}

export interface ProviderApi {
  listProviderProfiles: () => Promise<ProviderResult<ProviderProfilesState>>
  startProviderTest: (
    input: ProviderTestDraft
  ) => Promise<ProviderResult<ProviderTestStarted>>
  cancelProviderTest: (
    input: ProviderTestCancelInput
  ) => Promise<ProviderResult<{ readonly cancelled: boolean }>>
  saveTestedProvider: (
    input: ProviderSaveInput
  ) => Promise<ProviderResult<ProviderProfilesState>>
  deleteProvider: (
    input: ProviderProfileInput
  ) => Promise<ProviderResult<ProviderProfilesState>>
  activateProvider: (
    input: ProviderProfileInput
  ) => Promise<ProviderResult<ProviderProfilesState>>
  onProviderTestEvent: (listener: (event: ProviderTestEvent) => void) => () => void
}

export function providerSuccess<T>(data: T): ProviderResult<T> {
  return { ok: true, data }
}

export function providerFailure<T = never>(error: ProviderError): ProviderResult<T> {
  return { ok: false, error }
}
