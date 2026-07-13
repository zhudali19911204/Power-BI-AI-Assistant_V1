import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import type {
  ProviderCapabilities,
  ProviderProfileView,
  ProviderProfilesState
} from '../../shared/provider-contract'
import { ProviderServiceError } from './provider-error'

const MAX_CONFIG_BYTES = 1024 * 1024

const storedProfileSchema = z
  .object({
    id: z.string().uuid(),
    displayName: z.string().min(1).max(80),
    chatCompletionsUrl: z.string().url().max(2048),
    model: z.string().min(1).max(200),
    maxContextTokens: z.number().int().min(1024).max(10_000_000),
    supportsStreaming: z.boolean(),
    supportsJsonMode: z.boolean(),
    encryptedApiKeyBase64: z.string().min(1).max(32_768),
    updatedAt: z.string().datetime()
  })
  .strict()

const providerFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().nonnegative(),
    activeProfileId: z.string().uuid().nullable(),
    profiles: z.array(storedProfileSchema).max(50)
  })
  .strict()

export type StoredProviderProfile = z.infer<typeof storedProfileSchema>
type ProviderFile = z.infer<typeof providerFileSchema>

export interface SecretProtector {
  isAvailable: () => Promise<boolean>
  encrypt: (plainText: string) => Promise<string>
  decrypt: (
    encryptedBase64: string
  ) => Promise<{ readonly plainText: string; readonly shouldReEncrypt: boolean }>
}

export interface TestedProfileRecord extends ProviderCapabilities {
  readonly profileId?: string
  readonly displayName: string
  readonly chatCompletionsUrl: string
  readonly model: string
  readonly maxContextTokens: number
  readonly encryptedApiKeyBase64: string
}

function emptyFile(): ProviderFile {
  return {
    schemaVersion: 1,
    revision: 0,
    activeProfileId: null,
    profiles: []
  }
}

function toView(profile: StoredProviderProfile, activeProfileId: string | null): ProviderProfileView {
  return {
    id: profile.id,
    displayName: profile.displayName,
    chatCompletionsUrl: profile.chatCompletionsUrl,
    model: profile.model,
    maxContextTokens: profile.maxContextTokens,
    supportsStreaming: profile.supportsStreaming,
    supportsJsonMode: profile.supportsJsonMode,
    hasSecret: true,
    isActive: profile.id === activeProfileId,
    updatedAt: profile.updatedAt
  }
}

export class ProviderStore {
  private operationQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly filePath: string,
    private readonly protector: SecretProtector
  ) {}

  list(): Promise<ProviderProfilesState> {
    return this.exclusive(async () => this.toState(await this.readFile()))
  }

  async encryptSecret(apiKey: string): Promise<string> {
    await this.assertProtectorAvailable()
    try {
      return await this.protector.encrypt(apiKey)
    } catch {
      throw new ProviderServiceError('SECRET_STORAGE_UNAVAILABLE', true)
    }
  }

  async resolveExistingSecret(
    profileId: string
  ): Promise<{ readonly plainText: string; readonly encryptedApiKeyBase64: string }> {
    return this.exclusive(async () => {
      await this.assertProtectorAvailable()
      const data = await this.readFile()
      const profile = data.profiles.find((candidate) => candidate.id === profileId)
      if (!profile) throw new ProviderServiceError('PROFILE_NOT_FOUND', false)

      try {
        const decrypted = await this.protector.decrypt(profile.encryptedApiKeyBase64)
        const encryptedApiKeyBase64 = decrypted.shouldReEncrypt
          ? await this.protector.encrypt(decrypted.plainText)
          : profile.encryptedApiKeyBase64
        return { plainText: decrypted.plainText, encryptedApiKeyBase64 }
      } catch (error) {
        if (error instanceof ProviderServiceError) throw error
        throw new ProviderServiceError('SECRET_DECRYPT_FAILED', false)
      }
    })
  }

  saveTested(record: TestedProfileRecord): Promise<ProviderProfilesState> {
    return this.exclusive(async () => {
      const data = await this.readFile()
      const id = record.profileId ?? randomUUID()
      if (record.profileId && !data.profiles.some((profile) => profile.id === record.profileId)) {
        throw new ProviderServiceError('PROFILE_NOT_FOUND', false)
      }

      const nextProfile: StoredProviderProfile = {
        id,
        displayName: record.displayName,
        chatCompletionsUrl: record.chatCompletionsUrl,
        model: record.model,
        maxContextTokens: record.maxContextTokens,
        supportsStreaming: record.supportsStreaming,
        supportsJsonMode: record.supportsJsonMode,
        encryptedApiKeyBase64: record.encryptedApiKeyBase64,
        updatedAt: new Date().toISOString()
      }
      const profiles = data.profiles.some((profile) => profile.id === id)
        ? data.profiles.map((profile) => (profile.id === id ? nextProfile : profile))
        : [...data.profiles, nextProfile]
      const next: ProviderFile = {
        ...data,
        revision: data.revision + 1,
        activeProfileId: id,
        profiles
      }
      await this.writeFile(next)
      return this.toState(next)
    })
  }

  delete(profileId: string): Promise<ProviderProfilesState> {
    return this.exclusive(async () => {
      const data = await this.readFile()
      if (!data.profiles.some((profile) => profile.id === profileId)) {
        throw new ProviderServiceError('PROFILE_NOT_FOUND', false)
      }
      const profiles = data.profiles.filter((profile) => profile.id !== profileId)
      const next: ProviderFile = {
        ...data,
        revision: data.revision + 1,
        activeProfileId:
          data.activeProfileId === profileId ? (profiles[0]?.id ?? null) : data.activeProfileId,
        profiles
      }
      await this.writeFile(next)
      return this.toState(next)
    })
  }

  activate(profileId: string): Promise<ProviderProfilesState> {
    return this.exclusive(async () => {
      const data = await this.readFile()
      if (!data.profiles.some((profile) => profile.id === profileId)) {
        throw new ProviderServiceError('PROFILE_NOT_FOUND', false)
      }
      if (data.activeProfileId === profileId) return this.toState(data)
      const next = { ...data, revision: data.revision + 1, activeProfileId: profileId }
      await this.writeFile(next)
      return this.toState(next)
    })
  }

  private async assertProtectorAvailable(): Promise<void> {
    if (!(await this.protector.isAvailable().catch(() => false))) {
      throw new ProviderServiceError('SECRET_STORAGE_UNAVAILABLE', true)
    }
  }

  private toState(data: ProviderFile): ProviderProfilesState {
    return {
      revision: data.revision,
      profiles: data.profiles.map((profile) => toView(profile, data.activeProfileId))
    }
  }

  private async readFile(): Promise<ProviderFile> {
    try {
      const details = await stat(this.filePath)
      if (details.size > MAX_CONFIG_BYTES) {
        throw new ProviderServiceError('CONFIG_CORRUPT', false)
      }
      const contents = await readFile(this.filePath, 'utf8')
      return providerFileSchema.parse(JSON.parse(contents))
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return emptyFile()
      }
      if (error instanceof ProviderServiceError) throw error
      throw new ProviderServiceError('CONFIG_CORRUPT', false)
    }
  }

  private async writeFile(data: ProviderFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`
    try {
      await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
        flush: true
      })
      await rename(temporaryPath, this.filePath)
    } catch {
      await unlink(temporaryPath).catch(() => undefined)
      throw new ProviderServiceError('INTERNAL_ERROR', true)
    }
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation)
    this.operationQueue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}
