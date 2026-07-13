import { describe, expect, it } from 'vitest'
import {
  assertTrustedMainFrameSender,
  IpcSenderRejectedError,
  isTrustedMainFrameSender
} from '../../src/main/ipc/ipc-sender-policy'

function createFixture(): {
  readonly window: Electron.BrowserWindow
  readonly event: Electron.IpcMainInvokeEvent
  readonly mainFrame: object
  readonly webContents: object
} {
  const mainFrame = {}
  const webContents = {
    mainFrame,
    isDestroyed: () => false
  }
  const window = {
    isDestroyed: () => false,
    webContents
  } as unknown as Electron.BrowserWindow
  const event = {
    sender: webContents,
    senderFrame: mainFrame
  } as unknown as Electron.IpcMainInvokeEvent
  return { window, event, mainFrame, webContents }
}

describe('IPC main-frame sender policy', () => {
  it('accepts only the current main window main frame', () => {
    const fixture = createFixture()

    expect(isTrustedMainFrameSender(fixture.event, () => fixture.window)).toBe(true)
    expect(() => assertTrustedMainFrameSender(fixture.event, () => fixture.window)).not.toThrow()
  })

  it('rejects an iframe, another webContents, and a missing window', () => {
    const fixture = createFixture()

    expect(
      isTrustedMainFrameSender(
        { ...fixture.event, senderFrame: {} } as Electron.IpcMainInvokeEvent,
        () => fixture.window
      )
    ).toBe(false)
    expect(
      isTrustedMainFrameSender(
        { ...fixture.event, sender: {} } as Electron.IpcMainInvokeEvent,
        () => fixture.window
      )
    ).toBe(false)
    expect(isTrustedMainFrameSender(fixture.event, () => null)).toBe(false)
    expect(() => assertTrustedMainFrameSender(fixture.event, () => null)).toThrow(
      IpcSenderRejectedError
    )
  })

  it('fails closed when the window or its webContents is destroyed', () => {
    const fixture = createFixture()
    const destroyedWindow = {
      isDestroyed: () => true,
      webContents: fixture.webContents
    } as unknown as Electron.BrowserWindow
    const destroyedWebContentsWindow = {
      isDestroyed: () => false,
      webContents: {
        mainFrame: fixture.mainFrame,
        isDestroyed: () => true
      }
    } as unknown as Electron.BrowserWindow

    expect(isTrustedMainFrameSender(fixture.event, () => destroyedWindow)).toBe(false)
    expect(isTrustedMainFrameSender(fixture.event, () => destroyedWebContentsWindow)).toBe(false)
  })
})
