import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { describe, expect, it, vi } from 'vitest'
import {
  createRendererContentSecurityPolicy,
  createWindowOptions,
  DEVELOPMENT_REACT_REFRESH_CSP_HASH,
  isAllowedRendererNavigation,
  isAllowedRendererResource,
  normalizeSafeExternalHttpsUrl,
  resolveRendererTarget,
  type RendererTarget
} from '../../src/main/window'
import { secureRendererWindow } from '../../src/main/window-security'

describe('Electron main-to-renderer security boundary', () => {
  it('enables isolation, sandboxing, web security, and disables production DevTools', () => {
    const preloadPath = resolve('out/preload/index.js')
    const options = createWindowOptions(preloadPath, false, true)

    expect(options.webPreferences).toMatchObject({
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      devTools: false
    })
  })

  it('keeps the smoke-test window hidden', () => {
    const options = createWindowOptions(resolve('out/preload/index.js'), true)

    expect(options.show).toBe(false)
  })

  it('uses only an exact loopback development origin and ignores it when packaged', () => {
    const rendererPath = resolve('out/renderer/index.html')

    expect(
      resolveRendererTarget(rendererPath, 'http://localhost:5173/', false)
    ).toEqual({ mode: 'development', url: 'http://localhost:5173/' })
    expect(resolveRendererTarget(rendererPath, 'https://127.0.0.1:4173/', false)).toEqual({
      mode: 'development',
      url: 'https://127.0.0.1:4173/'
    })
    expect(resolveRendererTarget(rendererPath, 'https://attacker.example/', true)).toMatchObject({
      mode: 'production'
    })

    for (const unsafe of [
      'https://attacker.example/',
      'http://localhost.evil:5173/',
      'http://user@localhost:5173/',
      'file:///tmp/renderer.html',
      'http://localhost:5173/?token=secret',
      'http://localhost:5173/#fragment'
    ]) {
      expect(() => resolveRendererTarget(rendererPath, unsafe, false)).toThrow()
    }
  })

  it('allows exact application navigation and only local renderer resources', () => {
    const production = resolveRendererTarget(
      resolve('out/renderer/index.html'),
      undefined,
      true
    )
    const development: RendererTarget = {
      mode: 'development',
      url: 'http://localhost:5173/'
    }

    expect(isAllowedRendererNavigation(production.url, production)).toBe(true)
    expect(isAllowedRendererNavigation('https://attacker.example/', production)).toBe(false)
    expect(
      isAllowedRendererResource(new URL('./assets/app.js', production.url).href, 'script', production)
    ).toBe(true)
    expect(isAllowedRendererResource('https://attacker.example/a.js', 'script', production)).toBe(
      false
    )
    expect(isAllowedRendererResource('data:image/png;base64,AA==', 'image', production)).toBe(
      true
    )
    expect(isAllowedRendererResource('data:text/html,unsafe', 'subFrame', production)).toBe(false)
    expect(isAllowedRendererResource('http://localhost:5173/src/main.tsx', 'script', development)).toBe(
      true
    )
    expect(isAllowedRendererResource('ws://localhost:5173/hmr', 'webSocket', development)).toBe(
      true
    )
    expect(isAllowedRendererResource('ws://127.0.0.1:5173/hmr', 'webSocket', development)).toBe(
      false
    )
  })

  it('creates a production CSP with no Renderer network capability', () => {
    const production: RendererTarget = {
      mode: 'production',
      url: 'file:///C:/app/out/renderer/index.html'
    }
    const development: RendererTarget = {
      mode: 'development',
      url: 'http://localhost:5173/'
    }

    const productionPolicy = createRendererContentSecurityPolicy(production)
    const developmentPolicy = createRendererContentSecurityPolicy(development)
    const currentRefreshPreamble = react.preambleCode.replace('__BASE__', '/')
    const currentRefreshHash = `'sha256-${createHash('sha256')
      .update(currentRefreshPreamble)
      .digest('base64')}'`
    const rendererHtml = readFileSync(resolve('src/renderer/index.html'), 'utf8')

    expect(productionPolicy).toContain("connect-src 'none'")
    expect(productionPolicy).toContain("object-src 'none'")
    expect(productionPolicy).toContain("script-src 'self'")
    expect(productionPolicy).not.toContain(DEVELOPMENT_REACT_REFRESH_CSP_HASH)
    expect(developmentPolicy).toContain(
      "connect-src 'self' ws://localhost:5173"
    )
    expect(currentRefreshHash).toBe(DEVELOPMENT_REACT_REFRESH_CSP_HASH)
    expect(developmentPolicy).toContain(
      `script-src 'self' ${DEVELOPMENT_REACT_REFRESH_CSP_HASH}`
    )
    expect(rendererHtml).toContain(
      `script-src 'self' ${DEVELOPMENT_REACT_REFRESH_CSP_HASH}`
    )
  })

  it('opens only parsed HTTPS URLs on an explicit origin allowlist', () => {
    const allowed = new Set(['https://learn.microsoft.com'])

    expect(
      normalizeSafeExternalHttpsUrl('https://learn.microsoft.com/power-bi/', allowed)
    ).toBe('https://learn.microsoft.com/power-bi/')
    for (const unsafe of [
      'http://learn.microsoft.com/power-bi/',
      'https://learn.microsoft.com.evil/power-bi/',
      'https://user:password@learn.microsoft.com/power-bi/',
      'https://learn.microsoft.com/power-bi/#fragment',
      'javascript:alert(1)'
    ]) {
      expect(normalizeSafeExternalHttpsUrl(unsafe, allowed)).toBeNull()
    }
  })

  it('installs navigation, permission, request, CSP, and window-open guards', async () => {
    const target: RendererTarget = {
      mode: 'production',
      url: 'file:///C:/app/out/renderer/index.html'
    }
    const listeners = new Map<string, (...args: unknown[]) => unknown>()
    const hooks: {
      windowOpenHandler?: (details: { url: string }) => { action: string }
      beforeRequest?: (
          details: { webContentsId?: number; url: string; resourceType: string },
          callback: (response: { cancel?: boolean }) => void
        ) => void
      headersReceived?: (
          details: {
            webContentsId?: number
            url: string
            resourceType: string
            responseHeaders?: Record<string, string[]>
          },
          callback: (response: { responseHeaders?: unknown }) => void
        ) => void
      permissionCheck?: () => boolean
      permissionRequest?: (
        a: unknown,
        b: unknown,
        callback: (allowed: boolean) => void
      ) => void
    } = {}
    const openExternal = vi.fn(async () => undefined)
    const webContents = {
      id: 42,
      on: (name: string, listener: (...args: unknown[]) => unknown) => {
        listeners.set(name, listener)
      },
      setWindowOpenHandler: (handler: NonNullable<typeof hooks.windowOpenHandler>) => {
        hooks.windowOpenHandler = handler
      },
      session: {
        setPermissionCheckHandler: (handler: () => boolean) => {
          hooks.permissionCheck = handler
        },
        setPermissionRequestHandler: (
          handler: NonNullable<typeof hooks.permissionRequest>
        ) => {
          hooks.permissionRequest = handler
        },
        webRequest: {
          onBeforeRequest: (handler: NonNullable<typeof hooks.beforeRequest>) => {
            hooks.beforeRequest = handler
          },
          onHeadersReceived: (handler: NonNullable<typeof hooks.headersReceived>) => {
            hooks.headersReceived = handler
          }
        }
      }
    }

    secureRendererWindow(
      { webContents } as unknown as Electron.BrowserWindow,
      {
        rendererTarget: target,
        allowedExternalOrigins: new Set(['https://learn.microsoft.com']),
        openExternal
      }
    )

    const blockedNavigation = { url: 'https://attacker.example/', preventDefault: vi.fn() }
    listeners.get('will-navigate')?.(blockedNavigation)
    expect(blockedNavigation.preventDefault).toHaveBeenCalledOnce()

    const allowedNavigation = { url: target.url, preventDefault: vi.fn() }
    listeners.get('will-navigate')?.(allowedNavigation)
    expect(allowedNavigation.preventDefault).not.toHaveBeenCalled()

    const subframe = { url: target.url, isMainFrame: false, preventDefault: vi.fn() }
    listeners.get('will-frame-navigate')?.(subframe)
    expect(subframe.preventDefault).toHaveBeenCalledOnce()

    const redirect = { url: 'https://attacker.example/', preventDefault: vi.fn() }
    listeners.get('will-redirect')?.(redirect)
    expect(redirect.preventDefault).toHaveBeenCalledOnce()

    const webview = { preventDefault: vi.fn() }
    listeners.get('will-attach-webview')?.(webview)
    expect(webview.preventDefault).toHaveBeenCalledOnce()

    expect(hooks.permissionCheck?.()).toBe(false)
    const permissionCallback = vi.fn()
    hooks.permissionRequest?.({}, 'camera', permissionCallback)
    expect(permissionCallback).toHaveBeenCalledWith(false)

    const blockedRequest = vi.fn()
    hooks.beforeRequest?.(
      {
        webContentsId: 42,
        url: 'https://attacker.example/api',
        resourceType: 'xhr'
      },
      blockedRequest
    )
    expect(blockedRequest).toHaveBeenCalledWith({ cancel: true })

    const unrelatedRequest = vi.fn()
    hooks.beforeRequest?.(
      { webContentsId: 99, url: 'https://provider.example/', resourceType: 'xhr' },
      unrelatedRequest
    )
    expect(unrelatedRequest).toHaveBeenCalledWith({})

    const cspCallback = vi.fn()
    hooks.headersReceived?.(
      {
        webContentsId: 42,
        resourceType: 'mainFrame',
        url: target.url,
        responseHeaders: { Existing: ['value'] }
      },
      cspCallback
    )
    expect(cspCallback).toHaveBeenCalledWith({
      responseHeaders: expect.objectContaining({
        Existing: ['value'],
        'Content-Security-Policy': [expect.stringContaining("connect-src 'none'")]
      })
    })

    expect(hooks.windowOpenHandler?.({ url: 'https://attacker.example/' })).toEqual({
      action: 'deny'
    })
    expect(hooks.windowOpenHandler?.({ url: 'https://learn.microsoft.com/power-bi/' })).toEqual({
      action: 'deny'
    })
    await new Promise<void>((resolvePromise) => setImmediate(resolvePromise))
    expect(openExternal).toHaveBeenCalledWith('https://learn.microsoft.com/power-bi/')
    expect(openExternal).toHaveBeenCalledTimes(1)
  })
})
