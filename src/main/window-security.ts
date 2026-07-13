import type { BrowserWindow } from 'electron'
import {
  createRendererContentSecurityPolicy,
  isAllowedRendererNavigation,
  isAllowedRendererResource,
  normalizeSafeExternalHttpsUrl,
  type RendererTarget
} from './window'

export interface WindowSecurityOptions {
  readonly rendererTarget: RendererTarget
  readonly allowedExternalOrigins: ReadonlySet<string>
  readonly openExternal: (url: string) => Promise<unknown>
}

function withContentSecurityPolicy(
  headers: Record<string, string[]> | undefined,
  contentSecurityPolicy: string
): Record<string, string[]> {
  const nextHeaders: Record<string, string[]> = {}
  for (const [name, values] of Object.entries(headers ?? {})) {
    if (name.toLowerCase() !== 'content-security-policy') {
      nextHeaders[name] = values
    }
  }
  nextHeaders['Content-Security-Policy'] = [contentSecurityPolicy]
  return nextHeaders
}

export function secureRendererWindow(
  mainWindow: BrowserWindow,
  options: WindowSecurityOptions
): void {
  const { webContents } = mainWindow
  const { rendererTarget } = options
  const contentSecurityPolicy = createRendererContentSecurityPolicy(rendererTarget)

  webContents.on('will-navigate', (event) => {
    if (!isAllowedRendererNavigation(event.url, rendererTarget)) {
      event.preventDefault()
    }
  })

  webContents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame || !isAllowedRendererNavigation(event.url, rendererTarget)) {
      event.preventDefault()
    }
  })

  webContents.on('will-redirect', (event) => {
    if (!isAllowedRendererNavigation(event.url, rendererTarget)) {
      event.preventDefault()
    }
  })

  webContents.on('will-attach-webview', (event) => event.preventDefault())

  webContents.setWindowOpenHandler(({ url }) => {
    const safeUrl = normalizeSafeExternalHttpsUrl(url, options.allowedExternalOrigins)
    if (safeUrl) {
      setImmediate(() => {
        void options.openExternal(safeUrl).catch(() => undefined)
      })
    }
    return { action: 'deny' }
  })

  const { session } = webContents
  session.setPermissionCheckHandler(() => false)
  session.setPermissionRequestHandler((_requestingWebContents, _permission, callback) => {
    callback(false)
  })

  session.webRequest.onBeforeRequest((details, callback) => {
    if (details.webContentsId !== webContents.id) {
      callback({})
      return
    }

    callback({
      cancel: !isAllowedRendererResource(details.url, details.resourceType, rendererTarget)
    })
  })

  session.webRequest.onHeadersReceived((details, callback) => {
    if (
      details.webContentsId !== webContents.id ||
      details.resourceType !== 'mainFrame' ||
      !isAllowedRendererNavigation(details.url, rendererTarget)
    ) {
      callback({ responseHeaders: details.responseHeaders })
      return
    }

    callback({
      responseHeaders: withContentSecurityPolicy(
        details.responseHeaders,
        contentSecurityPolicy
      )
    })
  })
}
