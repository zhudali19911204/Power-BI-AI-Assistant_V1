import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ProviderStore,
  type SecretProtector
} from '../../src/main/provider/provider-store'

let directory = ''
let filePath = ''

class FakeProtector implements SecretProtector {
  available = true

  async isAvailable(): Promise<boolean> {
    return this.available
  }

  async encrypt(plainText: string): Promise<string> {
    return Buffer.from(`protected:${plainText}`, 'utf8').toString('base64')
  }

  async decrypt(
    encryptedBase64: string
  ): Promise<{ readonly plainText: string; readonly shouldReEncrypt: boolean }> {
    const decoded = Buffer.from(encryptedBase64, 'base64').toString('utf8')
    if (!decoded.startsWith('protected:')) throw new Error('invalid ciphertext')
    return { plainText: decoded.slice('protected:'.length), shouldReEncrypt: false }
  }
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'pbi-provider-store-'))
  filePath = join(directory, 'providers.v1.json')
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('ProviderStore', () => {
  it('persists only encrypted key material and never returns ciphertext to Renderer views', async () => {
    const protector = new FakeProtector()
    const store = new ProviderStore(filePath, protector)
    const secret = 'sentinel-plain-api-key'
    const encryptedApiKeyBase64 = await store.encryptSecret(secret)
    const saved = await store.saveTested({
      displayName: '测试 Provider',
      chatCompletionsUrl: 'https://api.example.com/v1/chat/completions',
      model: 'example-chat',
      maxContextTokens: 32_768,
      supportsStreaming: true,
      supportsJsonMode: false,
      encryptedApiKeyBase64
    })

    const disk = await readFile(filePath, 'utf8')
    expect(disk).not.toContain(secret)
    expect(JSON.stringify(saved)).not.toContain(secret)
    expect(JSON.stringify(saved)).not.toContain(encryptedApiKeyBase64)
    expect(saved.profiles[0]).toMatchObject({ hasSecret: true, isActive: true })
    expect(saved.profiles[0]).not.toHaveProperty('encryptedApiKeyBase64')
  })

  it('updates an existing profile serially and can reuse its decrypted secret', async () => {
    const protector = new FakeProtector()
    const store = new ProviderStore(filePath, protector)
    const encryptedApiKeyBase64 = await store.encryptSecret('key-1')
    const first = await store.saveTested({
      displayName: 'Provider A',
      chatCompletionsUrl: 'https://a.example.com/v1/chat/completions',
      model: 'model-a',
      maxContextTokens: 8192,
      supportsStreaming: true,
      supportsJsonMode: true,
      encryptedApiKeyBase64
    })
    const profileId = first.profiles[0]?.id
    if (!profileId) throw new Error('missing profile')

    const updated = await store.saveTested({
      profileId,
      displayName: 'Provider A2',
      chatCompletionsUrl: 'https://a.example.com/v1/chat/completions',
      model: 'model-a2',
      maxContextTokens: 16_384,
      supportsStreaming: true,
      supportsJsonMode: false,
      encryptedApiKeyBase64
    })
    await expect(store.resolveExistingSecret(profileId)).resolves.toMatchObject({
      plainText: 'key-1'
    })
    expect(updated.revision).toBe(2)
    expect(updated.profiles).toHaveLength(1)
    expect(updated.profiles[0]?.displayName).toBe('Provider A2')
  })

  it('fails closed when secure storage is unavailable or the config is corrupt', async () => {
    const protector = new FakeProtector()
    protector.available = false
    const store = new ProviderStore(filePath, protector)
    await expect(store.encryptSecret('must-not-persist')).rejects.toMatchObject({
      code: 'SECRET_STORAGE_UNAVAILABLE'
    })

    await writeFile(filePath, '{"schemaVersion":1,"profiles":"broken"}', 'utf8')
    await expect(store.list()).rejects.toMatchObject({ code: 'CONFIG_CORRUPT' })
  })
})
