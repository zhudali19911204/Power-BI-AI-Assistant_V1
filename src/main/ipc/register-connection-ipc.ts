import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import {
  CONNECTION_CONNECT_CHANNEL,
  CONNECTION_DISCONNECT_CHANNEL,
  CONNECTION_LIST_CHANNEL,
  CONNECTION_RECONNECT_CHANNEL,
  CONNECTION_STATE_CHANGED_CHANNEL,
  CONNECTION_STATE_CHANNEL,
  SCHEMA_SNAPSHOT_CHANNEL
} from '../../shared/connection-contract'
import { apiFailure, apiSuccess, type ApiResult } from '../../shared/result-contract'
import {
  ConnectionServiceError,
  PowerBiConnectionService,
  toApiError
} from '../powerbi/connection-service'
import {
  assertTrustedMainFrameSender,
  IpcSenderRejectedError,
  type MainWindowProvider
} from './ipc-sender-policy'

const connectInputSchema = z
  .object({ candidateId: z.string().uuid().max(64) })
  .strict()
const snapshotInputSchema = z
  .object({ connectionId: z.string().uuid().max(64) })
  .strict()

async function safeCall<T>(operation: () => Promise<T> | T): Promise<ApiResult<T>> {
  try {
    return apiSuccess(await operation())
  } catch (error) {
    if (error instanceof IpcSenderRejectedError) {
      return apiFailure({
        code: error.code,
        message: error.message,
        retryable: false
      })
    }
    return apiFailure(toApiError(error))
  }
}

function trustedCall<T>(
  event: IpcMainInvokeEvent,
  getMainWindow: MainWindowProvider,
  operation: () => Promise<T> | T
): Promise<ApiResult<T>> {
  return safeCall(() => {
    assertTrustedMainFrameSender(event, getMainWindow)
    return operation()
  })
}

function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new ConnectionServiceError('INVALID_INPUT', '请求参数无效。', false)
  }
  return result.data
}

export function registerConnectionIpc(
  service: PowerBiConnectionService,
  getMainWindow: MainWindowProvider
): () => void {
  ipcMain.handle(CONNECTION_LIST_CHANNEL, (event) =>
    trustedCall(event, getMainWindow, () => service.discover())
  )
  ipcMain.handle(CONNECTION_CONNECT_CHANNEL, (event, value: unknown) =>
    trustedCall(event, getMainWindow, () =>
      service.connectModel(parseInput(connectInputSchema, value).candidateId)
    )
  )
  ipcMain.handle(CONNECTION_DISCONNECT_CHANNEL, (event) =>
    trustedCall(event, getMainWindow, () => service.disconnect())
  )
  ipcMain.handle(CONNECTION_RECONNECT_CHANNEL, (event) =>
    trustedCall(event, getMainWindow, () => service.reconnect())
  )
  ipcMain.handle(CONNECTION_STATE_CHANNEL, (event) =>
    trustedCall(event, getMainWindow, () => service.getState())
  )
  ipcMain.handle(SCHEMA_SNAPSHOT_CHANNEL, (event, value: unknown) =>
    trustedCall(event, getMainWindow, () =>
      service.getSnapshot(parseInput(snapshotInputSchema, value).connectionId)
    )
  )

  const unsubscribe = service.subscribe((state) => {
    const mainWindow = getMainWindow()
    if (
      mainWindow &&
      !mainWindow.isDestroyed() &&
      !mainWindow.webContents.isDestroyed()
    ) {
      mainWindow.webContents.send(CONNECTION_STATE_CHANGED_CHANNEL, state)
    }
  })

  return () => {
    unsubscribe()
    ipcMain.removeHandler(CONNECTION_LIST_CHANNEL)
    ipcMain.removeHandler(CONNECTION_CONNECT_CHANNEL)
    ipcMain.removeHandler(CONNECTION_DISCONNECT_CHANNEL)
    ipcMain.removeHandler(CONNECTION_RECONNECT_CHANNEL)
    ipcMain.removeHandler(CONNECTION_STATE_CHANNEL)
    ipcMain.removeHandler(SCHEMA_SNAPSHOT_CHANNEL)
  }
}
