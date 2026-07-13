import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'

export type MainWindowProvider = () => BrowserWindow | null

export class IpcSenderRejectedError extends Error {
  readonly code = 'FORBIDDEN_IPC_SENDER' as const

  constructor() {
    super('IPC 请求来源无效。')
    this.name = 'IpcSenderRejectedError'
  }
}

export function isTrustedMainFrameSender(
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  getMainWindow: MainWindowProvider
): boolean {
  try {
    const mainWindow = getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) return false
    if (mainWindow.webContents.isDestroyed()) return false

    return (
      event.sender === mainWindow.webContents &&
      event.senderFrame === mainWindow.webContents.mainFrame
    )
  } catch {
    return false
  }
}

export function assertTrustedMainFrameSender(
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  getMainWindow: MainWindowProvider
): void {
  if (!isTrustedMainFrameSender(event, getMainWindow)) {
    throw new IpcSenderRejectedError()
  }
}
