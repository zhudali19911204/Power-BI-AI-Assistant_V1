import { describe, expect, it } from 'vitest'
import {
  assertSafeProviderResolution,
  validateProviderUrl
} from '../../src/main/provider/provider-url-policy'
import { ProviderServiceError } from '../../src/main/provider/provider-error'

describe('Provider URL security policy', () => {
  it.each([
    'http://api.example.com/v1/chat/completions',
    'file:///v1/chat/completions',
    'https://user:secret@example.com/v1/chat/completions',
    'https://example.com/v1/chat/completions#secret',
    'https://example.com/v1/models',
    'https://example.com/v1/chat/completions?api_key=secret',
    'https://example.com/v1/chat/completions?api-version=2026-01-01',
    'http://localhost.evil/v1/chat/completions'
  ])('rejects unsafe URL %s', (url) => {
    expect(() => validateProviderUrl(url)).toThrowError(
      expect.objectContaining({ code: 'UNSAFE_PROVIDER_URL' })
    )
  })

  it.each([
    'https://api.example.com/v1/chat/completions',
    'http://localhost:11434/v1/chat/completions',
    'http://127.0.0.1:8080/v1/chat/completions',
    'http://[::1]:8080/v1/chat/completions'
  ])('accepts an allowed full endpoint %s', (url) => {
    expect(validateProviderUrl(url).canonicalUrl).toContain('/chat/completions')
  })

  it('allows explicit localhost only when every resolution is loopback', async () => {
    const endpoint = validateProviderUrl('http://localhost:8080/v1/chat/completions')
    await expect(
      assertSafeProviderResolution(endpoint, async () => [
        { address: '127.0.0.1', family: 4 },
        { address: '::1', family: 6 }
      ])
    ).resolves.toBeUndefined()

    await expect(
      assertSafeProviderResolution(endpoint, async () => [
        { address: '127.0.0.1', family: 4 },
        { address: '10.0.0.8', family: 4 }
      ])
    ).rejects.toMatchObject({ code: 'PRIVATE_ADDRESS_BLOCKED' })
  })

  it('rejects a public hostname that resolves to private or link-local space', async () => {
    const endpoint = validateProviderUrl('https://api.example.com/v1/chat/completions')
    for (const address of ['10.0.0.1', '172.16.2.3', '192.168.1.1', '169.254.169.254']) {
      await expect(
        assertSafeProviderResolution(endpoint, async () => [{ address, family: 4 }])
      ).rejects.toBeInstanceOf(ProviderServiceError)
    }
  })
})
