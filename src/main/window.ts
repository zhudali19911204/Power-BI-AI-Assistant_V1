import type { BrowserWindowConstructorOptions } from 'electron'

export function createWindowOptions(
  preloadPath: string,
  isSmokeTest = false
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
      sandbox: true
    }
  }
}
