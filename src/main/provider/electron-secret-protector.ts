import { safeStorage } from 'electron'
import type { SecretProtector } from './provider-store'

export class ElectronSecretProtector implements SecretProtector {
  isAvailable(): Promise<boolean> {
    return safeStorage.isAsyncEncryptionAvailable()
  }

  async encrypt(plainText: string): Promise<string> {
    const encrypted = await safeStorage.encryptStringAsync(plainText)
    return encrypted.toString('base64')
  }

  async decrypt(
    encryptedBase64: string
  ): Promise<{ readonly plainText: string; readonly shouldReEncrypt: boolean }> {
    const decrypted = await safeStorage.decryptStringAsync(
      Buffer.from(encryptedBase64, 'base64')
    )
    return {
      plainText: decrypted.result,
      shouldReEncrypt: decrypted.shouldReEncrypt
    }
  }
}
