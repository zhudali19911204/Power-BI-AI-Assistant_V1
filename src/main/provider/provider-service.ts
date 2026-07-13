import { randomUUID } from 'node:crypto'
import type {
  ProviderProfileInput,
  ProviderProfilesState,
  ProviderSaveInput,
  ProviderTestCancelInput,
  ProviderTestDraft,
  ProviderTestEvent,
  ProviderTestStarted
} from '../../shared/provider-contract'
import { OpenAiCompatibleProviderClient } from './openai-compatible-client'
import { ProviderServiceError, toProviderError } from './provider-error'
import { ProviderStore, type TestedProfileRecord } from './provider-store'
import { validateProviderUrl } from './provider-url-policy'

const RECEIPT_TTL_MS = 10 * 60 * 1000
const MAX_ACTIVE_TESTS_PER_OWNER = 3
const MAX_RECEIPTS = 50

interface ActiveTest {
  readonly ownerId: number
  readonly controller: AbortController
  sequence: number
  output: string
}

interface TestedReceipt {
  readonly ownerId: number
  readonly expiresAt: number
  readonly record: TestedProfileRecord
}

export type ProviderEventSink = (event: ProviderTestEvent) => void
type ProviderEventPayload<T> = T extends ProviderTestEvent
  ? Omit<T, 'testId' | 'sequence'>
  : never
type AnyProviderEventPayload = ProviderEventPayload<ProviderTestEvent>

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0
    return code < 32 || code === 127
  })
}

export class ProviderService {
  private readonly activeTests = new Map<string, ActiveTest>()
  private readonly receipts = new Map<string, TestedReceipt>()

  constructor(
    private readonly store: ProviderStore,
    private readonly client: OpenAiCompatibleProviderClient
  ) {}

  list(): Promise<ProviderProfilesState> {
    return this.store.list()
  }

  async startTest(
    ownerId: number,
    draft: ProviderTestDraft,
    sink: ProviderEventSink
  ): Promise<ProviderTestStarted> {
    const ownerTests = [...this.activeTests.values()].filter(
      (operation) => operation.ownerId === ownerId
    ).length
    if (ownerTests >= MAX_ACTIVE_TESTS_PER_OWNER) {
      throw new ProviderServiceError('INVALID_INPUT', false)
    }

    const endpoint = validateProviderUrl(draft.chatCompletionsUrl)
    const displayName = draft.displayName.trim()
    const model = draft.model.trim()
    if (
      !displayName ||
      !model ||
      hasControlCharacters(displayName) ||
      hasControlCharacters(model)
    ) {
      throw new ProviderServiceError('INVALID_INPUT', false)
    }

    let apiKey: string
    let encryptedApiKeyBase64: string
    if (draft.apiKey !== undefined) {
      if (
        !draft.apiKey ||
        draft.apiKey.includes('\r') ||
        draft.apiKey.includes('\n') ||
        draft.apiKey.includes('\0')
      ) {
        throw new ProviderServiceError('INVALID_INPUT', false)
      }
      apiKey = draft.apiKey
      encryptedApiKeyBase64 = await this.store.encryptSecret(apiKey)
    } else if (draft.profileId) {
      const existing = await this.store.resolveExistingSecret(draft.profileId)
      apiKey = existing.plainText
      encryptedApiKeyBase64 = existing.encryptedApiKeyBase64
    } else {
      throw new ProviderServiceError('INVALID_INPUT', false)
    }

    const testId = randomUUID()
    const operation: ActiveTest = {
      ownerId,
      controller: new AbortController(),
      sequence: 0,
      output: ''
    }
    this.activeTests.set(testId, operation)

    const record = {
      profileId: draft.profileId,
      displayName,
      chatCompletionsUrl: endpoint.canonicalUrl,
      model,
      maxContextTokens: draft.maxContextTokens,
      encryptedApiKeyBase64
    }
    const emit = (event: AnyProviderEventPayload): void => {
      if (this.activeTests.get(testId) !== operation) return
      operation.sequence += 1
      sink({ ...event, testId, sequence: operation.sequence } as ProviderTestEvent)
    }

    setTimeout(() => {
      void this.runTest(testId, operation, endpoint, model, apiKey, record, emit)
      apiKey = ''
    }, 0)
    return { testId }
  }

  cancel(ownerId: number, input: ProviderTestCancelInput): { readonly cancelled: boolean } {
    const operation = this.activeTests.get(input.testId)
    if (!operation || operation.ownerId !== ownerId) return { cancelled: false }
    operation.controller.abort()
    return { cancelled: true }
  }

  async save(ownerId: number, input: ProviderSaveInput): Promise<ProviderProfilesState> {
    this.removeExpiredReceipts()
    const receipt = this.receipts.get(input.receiptId)
    if (!receipt || receipt.ownerId !== ownerId || receipt.expiresAt <= Date.now()) {
      throw new ProviderServiceError('TEST_RECEIPT_EXPIRED', false)
    }
    const result = await this.store.saveTested(receipt.record)
    this.receipts.delete(input.receiptId)
    return result
  }

  delete(input: ProviderProfileInput): Promise<ProviderProfilesState> {
    return this.store.delete(input.profileId)
  }

  activate(input: ProviderProfileInput): Promise<ProviderProfilesState> {
    return this.store.activate(input.profileId)
  }

  dispose(): void {
    for (const operation of this.activeTests.values()) operation.controller.abort()
    this.activeTests.clear()
    this.receipts.clear()
  }

  private async runTest(
    testId: string,
    operation: ActiveTest,
    endpoint: ReturnType<typeof validateProviderUrl>,
    model: string,
    apiKey: string,
    record: Omit<TestedProfileRecord, 'supportsStreaming' | 'supportsJsonMode'>,
    emit: (event: AnyProviderEventPayload) => void
  ): Promise<void> {
    emit({ type: 'started' })
    try {
      const result = await this.client.testConnection(
        { endpoint, model, apiKey },
        operation.controller.signal,
        {
          onChunk: (delta) => {
            operation.output += delta
            emit({ type: 'chunk', delta })
          },
          onRetry: (attempt, waitMs) => emit({ type: 'retry_wait', attempt, waitMs }),
          onCapability: (capability, supported) =>
            emit({ type: 'capability', capability, supported })
        }
      )
      this.removeExpiredReceipts()
      if (this.receipts.size >= MAX_RECEIPTS) {
        const oldest = this.receipts.keys().next().value as string | undefined
        if (oldest) this.receipts.delete(oldest)
      }
      const receiptId = randomUUID()
      const expiresAt = Date.now() + RECEIPT_TTL_MS
      this.receipts.set(receiptId, {
        ownerId: operation.ownerId,
        expiresAt,
        record: { ...record, ...result.capabilities }
      })
      emit({
        type: 'completed',
        output: result.output,
        capabilities: result.capabilities,
        receipt: { receiptId, expiresAt: new Date(expiresAt).toISOString() }
      })
    } catch (error) {
      const providerError = toProviderError(error)
      if (providerError.code === 'CANCELLED') {
        emit({ type: 'cancelled', output: operation.output })
      } else {
        emit({ type: 'failed', error: providerError })
      }
    } finally {
      this.activeTests.delete(testId)
    }
  }

  private removeExpiredReceipts(): void {
    const now = Date.now()
    for (const [id, receipt] of this.receipts) {
      if (receipt.expiresAt <= now) this.receipts.delete(id)
    }
  }
}
