import { ipcMain } from 'electron'
import { APP_INFO_CHANNEL, createAppInfo } from '../../shared/app-contract'
import {
  assertTrustedMainFrameSender,
  type MainWindowProvider
} from './ipc-sender-policy'

export function registerAppIpc(
  getMainWindow: MainWindowProvider,
  getVersion: () => string
): () => void {
  ipcMain.handle(APP_INFO_CHANNEL, (event) => {
    assertTrustedMainFrameSender(event, getMainWindow)
    return createAppInfo(getVersion())
  })

  return () => ipcMain.removeHandler(APP_INFO_CHANNEL)
}
