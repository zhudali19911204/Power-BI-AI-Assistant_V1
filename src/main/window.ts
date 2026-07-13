import { pathToFileURL } from 'node:url'
import type { BrowserWindowConstructorOptions } from 'electron'

export interface RendererTarget {
  readonly mode: 'development' | 'production'
  readonly url: string
}

// @vitejs/plugin-react injects this fixed preamble only in development.
// Keep the hash pinned so Fast Refresh works without allowing arbitrary inline scripts.
export const DEVELOPMENT_REACT_REFRESH_CSP_HASH =
  "'sha256-Z2/iFzh9VMlVkEOar1f/oSHWwQk3ve1qk/C2WdsC4Xk='"

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

function parseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

export function resolveRendererTarget(
  rendererFilePath: string,
  developmentRendererUrl: string | undefined,
  isPackaged: boolean
): RendererTarget {
  if (!isPackaged && developmentRendererUrl !== undefined) {
    if (
      developmentRendererUrl.length === 0 ||
      developmentRendererUrl.length > 2048 ||
      developmentRendererUrl.trim() !== developmentRendererUrl
    ) {
      throw new Error('开发服务器地址无效。')
    }

    const parsed = parseUrl(developmentRendererUrl)
    if (
      !parsed ||
      !['http:', 'https:'].includes(parsed.protocol) ||
      !LOOPBACK_HOSTNAMES.has(parsed.hostname) ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.search !== '' ||
      parsed.hash !== ''
    ) {
      throw new Error('开发服务器必须使用本机回环 HTTP(S) 地址。')
    }

    return { mode: 'development', url: parsed.href }
  }

  return { mode: 'production', url: pathToFileURL(rendererFilePath).href }
}

export function isAllowedRendererNavigation(
  candidateUrl: string,
  target: RendererTarget
): boolean {
  const candidate = parseUrl(candidateUrl)
  const expected = parseUrl(target.url)
  return candidate !== null && expected !== null && candidate.href === expected.href
}

export function isAllowedRendererResource(
  candidateUrl: string,
  resourceType: string,
  target: RendererTarget
): boolean {
  const candidate = parseUrl(candidateUrl)
  const expected = parseUrl(target.url)
  if (!candidate || !expected) return false

  if (candidate.protocol === 'data:') {
    return resourceType === 'image'
  }

  if (target.mode === 'development') {
    if (candidate.origin === expected.origin) return true

    const expectedWebSocketProtocol = expected.protocol === 'https:' ? 'wss:' : 'ws:'
    return (
      candidate.protocol === expectedWebSocketProtocol &&
      candidate.hostname === expected.hostname &&
      candidate.port === expected.port
    )
  }

  if (candidate.protocol !== 'file:' || expected.protocol !== 'file:') return false
  const rendererDirectory = new URL('./', expected).href
  return candidate.href.startsWith(rendererDirectory)
}

export function normalizeSafeExternalHttpsUrl(
  value: string,
  allowedOrigins: ReadonlySet<string>
): string | null {
  if (value.length === 0 || value.length > 2048 || value.trim() !== value) return null
  const parsed = parseUrl(value)
  if (
    !parsed ||
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.hash !== '' ||
    !allowedOrigins.has(parsed.origin)
  ) {
    return null
  }

  return parsed.href
}

export function createRendererContentSecurityPolicy(target: RendererTarget): string {
  const scriptSource =
    target.mode === 'development'
      ? `'self' ${DEVELOPMENT_REACT_REFRESH_CSP_HASH}`
      : "'self'"
  const connectSource =
    target.mode === 'production'
      ? "'none'"
      : (() => {
          const rendererUrl = new URL(target.url)
          const webSocketProtocol = rendererUrl.protocol === 'https:' ? 'wss:' : 'ws:'
          const webSocketOrigin = `${webSocketProtocol}//${rendererUrl.host}`
          return `'self' ${webSocketOrigin}`
        })()

  return [
    "default-src 'self'",
    `script-src ${scriptSource}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    `connect-src ${connectSource}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'"
  ].join('; ')
}

export function createWindowOptions(
  preloadPath: string,
  isSmokeTest = false,
  isPackaged = false
): BrowserWindowConstructorOptions {
  return {
    width: 1120,
    height: 720,
    minWidth: 920,
    minHeight: 620,
    show: !isSmokeTest,
    backgroundColor: '#f5f7fb',
    autoHideMenuBar: true,
    title: 'Power BI 智能助手',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      devTools: !isPackaged
    }
  }
}
