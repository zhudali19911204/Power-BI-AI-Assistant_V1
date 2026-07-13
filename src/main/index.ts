import { join } from 'node:path'
import { app, BrowserWindow, Menu, net, shell } from 'electron'
import { registerAppIpc } from './ipc/register-app-ipc'
import { registerConnectionIpc } from './ipc/register-connection-ipc'
import { registerProviderIpc } from './ipc/register-provider-ipc'
import { resolvePowerBiMcpBinary } from './mcp/mcp-binary-resolver'
import { PowerBiMcpClient } from './mcp/powerbi-mcp-client'
import { PowerBiConnectionService } from './powerbi/connection-service'
import { MicrosoftPowerBiReadAdapter } from './powerbi/powerbi-read-adapter'
import { ElectronSecretProtector } from './provider/electron-secret-protector'
import { OpenAiCompatibleProviderClient } from './provider/openai-compatible-client'
import { ProviderService } from './provider/provider-service'
import { ProviderStore } from './provider/provider-store'
import { createWindowOptions, resolveRendererTarget } from './window'
import { secureRendererWindow } from './window-security'

const isSmokeTest = process.env.PBI_ASSISTANT_SMOKE_TEST === '1'
const allowedExternalOrigins = new Set([
  'https://learn.microsoft.com',
  'https://github.com'
])
let mainWindow: BrowserWindow | null = null
let connectionService: PowerBiConnectionService | null = null
let providerService: ProviderService | null = null
let unregisterAppIpc: (() => void) | null = null
let unregisterConnectionIpc: (() => void) | null = null
let unregisterProviderIpc: (() => void) | null = null
let cleanupStarted = false

const smokeRenderTimeoutMs = 5_000
const smokeRenderPollIntervalMs = 100

// Chromium's network stack honors Windows trust roots and system proxy settings.
// This keeps Provider requests compatible with managed corporate networks.
const electronFetch: typeof fetch = (input, init) =>
  net.fetch(input instanceof URL ? input.toString() : input, init)

function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

async function waitForRenderedRoot(window: BrowserWindow): Promise<boolean> {
  const deadline = Date.now() + smokeRenderTimeoutMs

  while (!window.isDestroyed() && Date.now() < deadline) {
    try {
      const hasRenderedRoot = await window.webContents.executeJavaScript(
        "document.querySelector('#root')?.childElementCount > 0",
        true
      )
      if (hasRenderedRoot === true) return true
    } catch {
      // The document may still be navigating. Retry until the smoke timeout expires.
    }

    await new Promise<void>((resolve) => setTimeout(resolve, smokeRenderPollIntervalMs))
  }

  return false
}

function createMainWindow(): BrowserWindow {
  const rendererTarget = resolveRendererTarget(
    join(__dirname, '../renderer/index.html'),
    process.env.ELECTRON_RENDERER_URL,
    app.isPackaged
  )
  const nextWindow = new BrowserWindow(
    createWindowOptions(
      join(__dirname, '../preload/index.js'),
      isSmokeTest,
      app.isPackaged
    )
  )
  mainWindow = nextWindow

  secureRendererWindow(nextWindow, {
    rendererTarget,
    allowedExternalOrigins,
    openExternal: (url) => shell.openExternal(url)
  })

  void nextWindow.loadURL(rendererTarget.url)

  if (isSmokeTest) {
    let smokeFinished = false
    const finishSmokeTest = (success: boolean, detail: string): void => {
      if (smokeFinished) return
      smokeFinished = true
      if (success) {
        console.log('SMOKE_OK: renderer rendered')
      } else {
        console.error(`SMOKE_FAILED: ${detail}`)
      }
      app.exit(success ? 0 : 1)
    }

    nextWindow.webContents.once('did-finish-load', () => {
      void waitForRenderedRoot(nextWindow)
        .then((rendered) => {
          finishSmokeTest(rendered, 'renderer root stayed empty')
        })
        .catch((error: unknown) => {
          finishSmokeTest(false, error instanceof Error ? error.message : 'renderer check failed')
        })
    })
    nextWindow.webContents.once(
      'did-fail-load',
      (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
        if (isMainFrame) {
          finishSmokeTest(false, `load failed (${errorCode}): ${errorDescription}`)
        }
      }
    )
    nextWindow.webContents.once('render-process-gone', (_event, details) => {
      finishSmokeTest(false, `renderer process exited: ${details.reason}`)
    })
  }

  nextWindow.once('closed', () => {
    if (mainWindow === nextWindow) mainWindow = null
  })

  return nextWindow
}

void app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  unregisterAppIpc = registerAppIpc(getMainWindow, () => app.getVersion())
  const mcpBinary = resolvePowerBiMcpBinary({
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    isPackaged: app.isPackaged
  })
  const mcpClient = new PowerBiMcpClient(mcpBinary)
  connectionService = new PowerBiConnectionService(new MicrosoftPowerBiReadAdapter(mcpClient))
  unregisterConnectionIpc = registerConnectionIpc(connectionService, getMainWindow)
  const providerStore = new ProviderStore(
    join(app.getPath('userData'), 'power-bi-ai-assistant', 'providers.v1.json'),
    new ElectronSecretProtector()
  )
  providerService = new ProviderService(
    providerStore,
    new OpenAiCompatibleProviderClient({ fetch: electronFetch })
  )
  unregisterProviderIpc = registerProviderIpc(providerService, getMainWindow)
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('before-quit', (event) => {
  if (cleanupStarted) return
  unregisterAppIpc?.()
  unregisterAppIpc = null
  unregisterConnectionIpc?.()
  unregisterConnectionIpc = null
  unregisterProviderIpc?.()
  unregisterProviderIpc = null
  providerService?.dispose()
  providerService = null
  if (!connectionService) return
  event.preventDefault()
  cleanupStarted = true
  const service = connectionService
  connectionService = null
  void service.dispose().finally(() => app.quit())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
