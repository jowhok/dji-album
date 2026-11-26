import { app, BrowserWindow, dialog } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { initDb } from './db'
import { registerIpc } from './ipc'
import { startMediaServer, stopMediaServer } from './media-server'

// Windows 任务栏分组/跳转列表独立，避免归到 Electron 默认组
app.setAppUserModelId('com.wei.dji-album')

function getIconPath(): string | undefined {
  // 打包后由 extraResources 放到 resources/icon.ico；开发态直接读项目 build/
  const p = app.isPackaged
    ? join(process.resourcesPath, 'icon.ico')
    : join(__dirname, '../../build/icon.ico')
  return existsSync(p) ? p : undefined
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#1b1b19',
    autoHideMenuBar: true,
    title: 'DJI 相册',
    icon: getIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  registerIpc(win)

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.once('ready-to-show', () => {
    win.show()
    win.focus()
    win.setAlwaysOnTop(true)
    setTimeout(() => {
      if (!win.isDestroyed()) win.setAlwaysOnTop(false)
    }, 2000)
  })
}

app.whenReady().then(async () => {
  initDb()
  const mediaPort = await startMediaServer()
  console.log(`[media-server] 127.0.0.1:${mediaPort}`)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}).catch((e: unknown) => {
  const msg = e instanceof Error ? `${e.message}\n\n${e.stack ?? ''}` : String(e)
  console.error('[startup failed]', msg)
  dialog.showErrorBox('DJI 相册启动失败', msg)
  app.quit()
})

app.on('window-all-closed', () => {
  stopMediaServer()
  app.quit()
})
