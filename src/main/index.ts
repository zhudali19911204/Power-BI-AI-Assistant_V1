import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron'
import { APP_INFO_CHANNEL, createAppInfo } from '../shared/app-contract'
import { createWindowOptions } from './window'

const isSmokeTest = process.env.PBI_ASSISTANT_SMOKE_TEST === '1'

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
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
