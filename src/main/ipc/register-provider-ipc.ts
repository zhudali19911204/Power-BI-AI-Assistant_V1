import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import {
  PROVIDER_ACTIVATE_CHANNEL,
  PROVIDER_DELETE_CHANNEL,
  PROVIDER_LIST_CHANNEL,
  PROVIDER_SAVE_CHANNEL,
  PROVIDER_TEST_CANCEL_CHANNEL,
  PROVIDER_TEST_EVENT_CHANNEL,
  PROVIDER_TEST_START_CHANNEL,
  providerFailure,
  providerSuccess,
  type ProviderResult
} from '../../shared/provider-contract'
import { ProviderServiceError, toProviderError } from '../provider/provider-error'
import { ProviderService } from '../provider/provider-service'
import {
  assertTrustedMainFrameSender,
  IpcSenderRejectedError,
  type MainWindowProvider
} from './ipc-sender-policy'

const draftSchema = z
  .object({
    profileId: z.string().uuid().optional(),
    displayName: z.string().min(1).max(80),
    chatCompletionsUrl: z.string().min(1).max(2048),
    model: z.string().min(1).max(200),
    maxContextTokens: z.number().int().min(1024).max(10_000_000),
    apiKey: z.string().min(1).max(4096).optional()
  })
  .strict()
const cancelSchema = z.object({ testId: z.string().uuid() }).strict()
const saveSchema = z.object({ receiptId: z.string().uuid() }).strict()
const profileSchema = z.object({ profileId: z.string().uuid() }).strict()

function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input)
  if (!parsed.success) throw new ProviderServiceError('INVALID_INPUT', false)
  return parsed.data
}

async function safeCall<T>(operation: () => Promise<T> | T): Promise<ProviderResult<T>> {
  try {
    return providerSuccess(await operation())
  } catch (error) {
    if (error instanceof IpcSenderRejectedError) {
      return providerFailure({
        code: 'FORBIDDEN_IPC_SENDER',
        message: '当前页面无权执行此操作。',
        retryable: false
      })
    }
    return providerFailure(toProviderError(error))
  }
}

export function registerProviderIpc(
  service: ProviderService,
  getMainWindow: MainWindowProvider
): () => void {
  const authorize = (event: IpcMainInvokeEvent): number => {
    assertTrustedMainFrameSender(event, getMainWindow)
    return event.sender.id
  }

  ipcMain.handle(PROVIDER_LIST_CHANNEL, (event) =>
    safeCall(() => {
      authorize(event)
      return service.list()
    })
  )
  ipcMain.handle(PROVIDER_TEST_START_CHANNEL, (event, input: unknown) =>
    safeCall(() => {
      const ownerId = authorize(event)
      const draft = parseInput(draftSchema, input)
      return service.startTest(ownerId, draft, (providerEvent) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(PROVIDER_TEST_EVENT_CHANNEL, providerEvent)
        }
      })
    })
  )
  ipcMain.handle(PROVIDER_TEST_CANCEL_CHANNEL, (event, input: unknown) =>
    safeCall(() => service.cancel(authorize(event), parseInput(cancelSchema, input)))
  )
  ipcMain.handle(PROVIDER_SAVE_CHANNEL, (event, input: unknown) =>
    safeCall(() => service.save(authorize(event), parseInput(saveSchema, input)))
  )
  ipcMain.handle(PROVIDER_DELETE_CHANNEL, (event, input: unknown) =>
    safeCall(() => {
      authorize(event)
      return service.delete(parseInput(profileSchema, input))
    })
  )
  ipcMain.handle(PROVIDER_ACTIVATE_CHANNEL, (event, input: unknown) =>
    safeCall(() => {
      authorize(event)
      return service.activate(parseInput(profileSchema, input))
    })
  )

  return () => {
    ipcMain.removeHandler(PROVIDER_LIST_CHANNEL)
    ipcMain.removeHandler(PROVIDER_TEST_START_CHANNEL)
    ipcMain.removeHandler(PROVIDER_TEST_CANCEL_CHANNEL)
    ipcMain.removeHandler(PROVIDER_SAVE_CHANNEL)
    ipcMain.removeHandler(PROVIDER_DELETE_CHANNEL)
    ipcMain.removeHandler(PROVIDER_ACTIVATE_CHANNEL)
  }
}
