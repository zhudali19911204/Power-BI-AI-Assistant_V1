import { describe, expect, it, vi } from 'vitest'
import type { ProviderTestEvent } from '../../src/shared/provider-contract'
import type { OpenAiCompatibleProviderClient } from '../../src/main/provider/openai-compatible-client'
import { ProviderServiceError } from '../../src/main/provider/provider-error'
import { ProviderService } from '../../src/main/provider/provider-service'
import type { ProviderStore } from '../../src/main/provider/provider-store'

function testDraft() {
  return {
    displayName: 'Provider A',
    chatCompletionsUrl: 'https://api.example.com/v1/chat/completions',
    model: 'model-a',
    maxContextTokens: 32_768,
    apiKey: 'plain-secret-sentinel'
  }
}

describe('ProviderService test receipt gate', () => {
  it('emits sanitized events and saves only a successful short-lived receipt', async () => {
    const saveTested = vi.fn(async () => ({ revision: 1, profiles: [] }))
    const store = {
      list: vi.fn(),
      encryptSecret: vi.fn(async () => 'dpapi-ciphertext'),
      saveTested
    } as unknown as ProviderStore
    const client = {
      testConnection: vi.fn(async (_input, _signal, events) => {
        events.onChunk('连接')
        events.onChunk('成功')
        events.onCapability('streaming', true)
        events.onCapability('json_mode', false)
        return {
          output: '连接成功',
          capabilities: { supportsStreaming: true, supportsJsonMode: false }
        }
      })
    } as unknown as OpenAiCompatibleProviderClient
    const service = new ProviderService(store, client)
    const emitted: ProviderTestEvent[] = []

    await service.startTest(7, testDraft(), (event) => emitted.push(event))
    await vi.waitFor(() =>
      expect(emitted.some((event) => event.type === 'completed')).toBe(true)
    )
    const completed = emitted.find(
      (event): event is Extract<ProviderTestEvent, { type: 'completed' }> =>
        event.type === 'completed'
    )
    if (!completed) throw new Error('missing completed event')

    expect(JSON.stringify(emitted)).not.toContain('plain-secret-sentinel')
    expect(JSON.stringify(emitted)).not.toContain('dpapi-ciphertext')
    expect(emitted.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6])
    expect(saveTested).not.toHaveBeenCalled()

    await service.save(7, { receiptId: completed.receipt.receiptId })
    expect(saveTested).toHaveBeenCalledWith(
      expect.objectContaining({
        encryptedApiKeyBase64: 'dpapi-ciphertext',
        supportsStreaming: true,
        supportsJsonMode: false
      })
    )
    expect(JSON.stringify(saveTested.mock.calls)).not.toContain('plain-secret-sentinel')

    await expect(
      service.save(7, { receiptId: completed.receipt.receiptId })
    ).rejects.toMatchObject({ code: 'TEST_RECEIPT_EXPIRED' })
  })

  it('binds tests and receipts to their owner and reports cancellation', async () => {
    const store = {
      encryptSecret: vi.fn(async () => 'ciphertext'),
      saveTested: vi.fn()
    } as unknown as ProviderStore
    const client = {
      testConnection: vi.fn(
        (_input, signal: AbortSignal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () =>
              reject(new ProviderServiceError('CANCELLED', false))
            )
          })
      )
    } as unknown as OpenAiCompatibleProviderClient
    const service = new ProviderService(store, client)
    const emitted: ProviderTestEvent[] = []
    const started = await service.startTest(10, testDraft(), (event) => emitted.push(event))
    await vi.waitFor(() => expect(client.testConnection).toHaveBeenCalledOnce())

    expect(service.cancel(11, { testId: started.testId })).toEqual({ cancelled: false })
    expect(service.cancel(10, { testId: started.testId })).toEqual({ cancelled: true })
    await vi.waitFor(() =>
      expect(emitted.some((event) => event.type === 'cancelled')).toBe(true)
    )
    expect(emitted.at(-1)).toMatchObject({ type: 'cancelled' })
  })
})
