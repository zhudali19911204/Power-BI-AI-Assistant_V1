import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron'
import { APP_INFO_CHANNEL, createAppInfo } from '../shared/app-contract'
import { registerConnectionIpc } from './ipc/register-connection-ipc'
import { resolvePowerBiMcpBinary } from './mcp/mcp-binary-resolver'
import { PowerBiMcpClient } from './mcp/powerbi-mcp-client'
import { PowerBiConnectionService } from './powerbi/connection-service'
import { MicrosoftPowerBiReadAdapter } from './powerbi/powerbi-read-adapter'
import { createWindowOptions } from './window'

const isSmokeTest = process.env.PBI_ASSISTANT_SMOKE_TEST === '1'
let connectionService: PowerBiConnectionService | null = null
let unregisterConnectionIpc: (() => void) | null = null
let cleanupStarted = false

function registerIpcHandlers(): void {
  ipcMain.handle(APP_INFO_CHANNEL, () => createAppInfo(app.getVersion()))
}

function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow(
    createWindowOptions(join(__dirname, '../preload/index.js'), isSmokeTest)
  )

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      void shell.openExternal(url)
    }

    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  if (isSmokeTest) {
    mainWindow.webContents.once('did-finish-load', () => {
      console.log('SMOKE_OK: renderer loaded')
      app.exit(0)
    })
  }

  return mainWindow
}

void app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  registerIpcHandlers()
  const mcpBinary = resolvePowerBiMcpBinary({
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    isPackaged: app.isPackaged
  })
  const mcpClient = new PowerBiMcpClient(mcpBinary)
  connectionService = new PowerBiConnectionService(new MicrosoftPowerBiReadAdapter(mcpClient))
  unregisterConnectionIpc = registerConnectionIpc(connectionService)
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('before-quit', (event) => {
  if (cleanupStarted || !connectionService) return
  event.preventDefault()
  cleanupStarted = true
  unregisterConnectionIpc?.()
  unregisterConnectionIpc = null
  const service = connectionService
  connectionService = null
  void service.dispose().finally(() => app.quit())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
