import { lookup as nodeLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { ProviderServiceError } from './provider-error'

export interface ProviderEndpoint {
  readonly url: URL
  readonly canonicalUrl: string
  readonly isExplicitLoopback: boolean
}

export type ProviderDnsLookup = (
  hostname: string
) => Promise<readonly { readonly address: string; readonly family: number }[]>

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0
    return code < 32 || code === 127
  })
}

function normalizedHostname(url: URL): string {
  const hostname = url.hostname.toLowerCase()
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname
}

function ipv4Parts(address: string): readonly number[] | null {
  if (isIP(address) !== 4) return null
  const parts = address.split('.').map(Number)
  return parts.length === 4 ? parts : null
}

export function isLoopbackAddress(address: string): boolean {
  const normalized = address.toLowerCase()
  const parts = ipv4Parts(normalized)
  if (parts) return parts[0] === 127
  return normalized === '::1' || normalized.startsWith('::ffff:127.')
}

export function isForbiddenPrivateAddress(address: string): boolean {
  if (isLoopbackAddress(address)) return true

  const parts = ipv4Parts(address)
  if (parts) {
    const [a = -1, b = -1] = parts
    return (
      a === 0 ||
      a === 10 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    )
  }

  if (isIP(address) === 6) {
    const normalized = address.toLowerCase()
    return (
      normalized === '::' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      /^fe[89ab]/u.test(normalized) ||
      normalized.startsWith('ff') ||
      normalized.startsWith('::ffff:')
    )
  }

  return true
}

export function validateProviderUrl(value: string): ProviderEndpoint {
  if (value.length > 2048 || hasControlCharacters(value)) {
    throw new ProviderServiceError('UNSAFE_PROVIDER_URL', false)
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ProviderServiceError('UNSAFE_PROVIDER_URL', false)
  }

  if (url.username || url.password || url.hash || !url.hostname) {
    throw new ProviderServiceError('UNSAFE_PROVIDER_URL', false)
  }

  const hostname = normalizedHostname(url)
  const isExplicitLoopback = hostname === 'localhost' || isLoopbackAddress(hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isExplicitLoopback)) {
    throw new ProviderServiceError('UNSAFE_PROVIDER_URL', false)
  }

  if (url.search) {
    throw new ProviderServiceError('UNSAFE_PROVIDER_URL', false)
  }

  const normalizedPath = url.pathname.replace(/\/+$/u, '')
  if (!normalizedPath.toLowerCase().endsWith('/chat/completions')) {
    throw new ProviderServiceError('UNSAFE_PROVIDER_URL', false)
  }

  return {
    url,
    canonicalUrl: url.toString(),
    isExplicitLoopback
  }
}

const defaultLookup: ProviderDnsLookup = async (hostname) =>
  nodeLookup(hostname, { all: true, verbatim: true })

export async function assertSafeProviderResolution(
  endpoint: ProviderEndpoint,
  lookup: ProviderDnsLookup = defaultLookup
): Promise<void> {
  const hostname = normalizedHostname(endpoint.url)
  const literalFamily = isIP(hostname)
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await lookup(hostname).catch(() => {
        throw new ProviderServiceError('NETWORK_ERROR', true)
      })

  if (addresses.length === 0) {
    throw new ProviderServiceError('NETWORK_ERROR', true)
  }

  const valid = endpoint.isExplicitLoopback
    ? addresses.every(({ address }) => isLoopbackAddress(address))
    : addresses.every(({ address }) => !isForbiddenPrivateAddress(address))

  if (!valid) {
    throw new ProviderServiceError('PRIVATE_ADDRESS_BLOCKED', false)
  }
}
