import { BrowserWindow, ipcMain, type IpcMainEvent } from 'electron'
import type {
  IpcCaptureChannel,
  IpcCaptureSend,
  IpcInvoke,
  IpcInvokeChannel,
  IpcPush,
  IpcPushChannel
} from '@shared/types'

/** Register a handler for a renderer → main invoke channel. Returns an unregister function. */
export function handle<C extends IpcInvokeChannel>(
  channel: C,
  fn: (req: IpcInvoke[C]['req']) => IpcInvoke[C]['res'] | Promise<IpcInvoke[C]['res']>
): () => void {
  ipcMain.handle(channel, (_e, req) => fn(req))
  return () => ipcMain.removeHandler(channel)
}

/** Push to one window. Ignores destroyed windows. */
export function push<C extends IpcPushChannel>(
  win: BrowserWindow | null | undefined,
  channel: C,
  payload: IpcPush[C]
): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

/** Push to every open window. */
export function broadcast<C extends IpcPushChannel>(channel: C, payload: IpcPush[C]): void {
  for (const win of BrowserWindow.getAllWindows()) push(win, channel, payload)
}

/** Listen for capture renderer → main messages. */
export function onCapture<C extends IpcCaptureChannel>(
  channel: C,
  fn: (payload: IpcCaptureSend[C], e: IpcMainEvent) => void
): () => void {
  const listener = (e: IpcMainEvent, payload: IpcCaptureSend[C]): void => fn(payload, e)
  ipcMain.on(channel, listener)
  return () => ipcMain.off(channel, listener)
}
