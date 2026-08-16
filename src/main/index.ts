import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  broadcastAgentsChanged,
  broadcastPermissionRequest,
  broadcastPermissionResolved,
  broadcastRuntime,
  broadcastTranscript,
  broadcastTranscriptCleared,
  registerIpcHandlers
} from './ipc'
import { ConfigStore } from './config-store'
import { AgentSupervisor } from './agent-supervisor'
import { ConversationStore } from './conversation-store'

// OPEN_ROOM_HOME relocates the config root. Useful for testing against a
// throwaway directory, and for anyone who keeps dotfiles somewhere else.
const store = new ConfigStore(process.env.OPEN_ROOM_HOME || undefined)

const conversations = new ConversationStore()

const supervisor = new AgentSupervisor(
  {
    onRuntime: broadcastRuntime,
    onTranscript: broadcastTranscript,
    onPermissionRequest: broadcastPermissionRequest,
    onPermissionResolved: broadcastPermissionResolved,
    onTranscriptCleared: broadcastTranscriptCleared
  },
  conversations
)

/** Ends sessions left idle, since each one holds a full CLI subprocess. */
let idleReaper: NodeJS.Timeout | null = null

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0a0a0a',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Stated explicitly rather than relying on defaults: the renderer gets
      // no Node access, and all main-process capability arrives via preload.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // External links open in the user's browser, never in an app window.
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.openroom.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const settings = await store.readSettings()
  supervisor.setOptions({ maxConcurrent: settings.maxConcurrentAgents })

  registerIpcHandlers(store, supervisor, conversations)
  createWindow()

  // Agent files are hand-editable, so edits made outside the app must show up
  // without a restart.
  store.startWatching(broadcastAgentsChanged).catch((error) => {
    console.error('Failed to watch the agents directory:', error)
  })

  if (settings.idleTimeoutMinutes > 0) {
    const maxIdleMs = settings.idleTimeoutMinutes * 60_000
    idleReaper = setInterval(() => {
      void supervisor.reapIdle(maxIdleMs)
    }, 60_000)
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', async (event) => {
  store.stopWatching()
  if (idleReaper) clearInterval(idleReaper)

  // Agent subprocesses outlive the app unless they are stopped, so quitting
  // waits for teardown once.
  if (supervisor.runningCount > 0) {
    event.preventDefault()
    await supervisor.stopAll()
    app.quit()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
