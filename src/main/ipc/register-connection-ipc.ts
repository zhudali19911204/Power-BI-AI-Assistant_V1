import { BrowserWindow, ipcMain } from 'electron'
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
    return apiFailure(toApiError(error))
  }
}

function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new ConnectionServiceError('INVALID_INPUT', '请求参数无效。', false)
  }
  return result.data
}

export function registerConnectionIpc(service: PowerBiConnectionService): () => void {
  ipcMain.handle(CONNECTION_LIST_CHANNEL, () => safeCall(() => service.discover()))
  ipcMain.handle(CONNECTION_CONNECT_CHANNEL, (_event, value: unknown) =>
    safeCall(() => service.connectModel(parseInput(connectInputSchema, value).candidateId))
  )
  ipcMain.handle(CONNECTION_DISCONNECT_CHANNEL, () => safeCall(() => service.disconnect()))
  ipcMain.handle(CONNECTION_RECONNECT_CHANNEL, () => safeCall(() => service.reconnect()))
  ipcMain.handle(CONNECTION_STATE_CHANNEL, () => safeCall(() => service.getState()))
  ipcMain.handle(SCHEMA_SNAPSHOT_CHANNEL, (_event, value: unknown) =>
    safeCall(() => service.getSnapshot(parseInput(snapshotInputSchema, value).connectionId))
  )

  const unsubscribe = service.subscribe((state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(CONNECTION_STATE_CHANGED_CHANNEL, state)
      }
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
