import { app, shell, BrowserWindow, ipcMain, session, systemPreferences } from 'electron'
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
import { SpeechBus } from './speech-bus'
import { NotificationSink } from './notification-sink'
import { VoiceSidecar } from './voice-sidecar'
import { VoiceSink } from './voice-sink'
import { OverlayWindow } from './overlay-window'
import { HotkeyManager, bindingsFor, type HotkeyFailure } from './hotkey-manager'
import { VoiceController } from './voice-controller'
import { IpcChannel } from '@shared/ipc'
import { isOverlayEvent } from '@shared/voice-input'

// OPEN_ROOM_HOME relocates the config root. Useful for testing against a
// throwaway directory, and for anyone who keeps dotfiles somewhere else.
const store = new ConfigStore(process.env.OPEN_ROOM_HOME || undefined)

const conversations = new ConversationStore()

// One global playback lane for every agent. The sink decides delivery —
// speech for agents with TTS on, notifications for everyone else and whenever
// the sidecar is unavailable.
const voiceScript = app.isPackaged
  ? join(process.resourcesPath, 'app.asar', 'out', 'main', 'voice.js')
  : join(app.getAppPath(), 'out', 'main', 'voice.js')
const voice = new VoiceSidecar(voiceScript)
const speech = new SpeechBus(new VoiceSink(voice, new NotificationSink(), store))

const supervisor = new AgentSupervisor(
  {
    onRuntime: broadcastRuntime,
    onTranscript: broadcastTranscript,
    onPermissionRequest: broadcastPermissionRequest,
    onPermissionResolved: broadcastPermissionResolved,
    onTranscriptCleared: broadcastTranscriptCleared
  },
  conversations,
  speech
)

/**
 * The listening overlay and working HUD.
 *
 * Created at launch and kept for the process lifetime — shown and hidden,
 * never created and destroyed.
 */
const overlay = new OverlayWindow()

/** Ends sessions left idle, since each one holds a full CLI subprocess. */
let idleReaper: NodeJS.Timeout | null = null

/**
 * Which agent the main window has selected.
 *
 * The global push-to-talk binding addresses "the selected agent" and the
 * renderer owns that selection, so it reports it here on every change.
 */
let selectedAgentId: string | null = null

/** Bindings that could not be registered. Surfaced in the settings dialog. */
let hotkeyFailures: HotkeyFailure[] = []

const hotkeys = new HotkeyManager((agentId) => void controller.onTrigger(agentId))

const controller = new VoiceController({
  overlay,
  sidecar: voice,
  supervisor,
  readSettings: () => store.readSettings(),
  listAgents: async () => (await store.list()).agents,
  isModelInstalled: async () => (await voice.sttStatus().catch(() => null))?.installed ?? false,
  selectedAgentId: () => selectedAgentId,

  // Asked on first capture rather than at launch. Prompting for a microphone
  // at startup, for a feature that ships off, is both confusing and a bad
  // look. Only macOS has anything to ask; Windows grants at the OS level.
  ensureMicrophoneAccess: async () => {
    if (process.platform !== 'darwin') return true
    if (systemPreferences.getMediaAccessStatus('microphone') === 'granted') return true
    return systemPreferences.askForMediaAccess('microphone')
  },

  // ConversationStore.list already resolves the display title
  // (customTitle || firstPrompt || summary), so this only has to match the
  // runtime's active conversation against it.
  conversationTitleFor: async (agentId) => {
    const agent = (await store.list()).agents.find((a) => a.config.id === agentId)
    if (!agent) return ''

    const active = supervisor.runtimeFor(agentId).activeConversationId
    if (!active) return 'New conversation'

    const conversation = (await conversations.list(agent)).find((c) => c.sessionId === active)
    return conversation?.title ?? 'New conversation'
  },

  startCapture: () => overlay.startCapture(),
  stopCapture: () => overlay.stopCapture(),
  discardCapture: () => overlay.discardCapture(),
  registerEscape: (handler) => hotkeys.registerEscape(handler),
  unregisterEscape: () => hotkeys.unregisterEscape()
})

/**
 * Re-registers every global shortcut.
 *
 * Run at launch and whenever settings or the agent files change, since both
 * can add, remove or rebind a hotkey.
 */
async function refreshHotkeys(): Promise<void> {
  const [settings, loaded] = await Promise.all([store.readSettings(), store.list()])
  hotkeyFailures = hotkeys.apply(bindingsFor(settings, loaded.agents))

  for (const failure of hotkeyFailures) {
    console.warn(`Hotkey ${failure.accelerator} could not be registered: ${failure.reason}`)
  }
}

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

  voice.start()
  registerIpcHandlers(store, supervisor, conversations, voice, () => void refreshHotkeys())
  createWindow()

  ipcMain.on(IpcChannel.selectAgent, (_event, agentId: string | null) => {
    selectedAgentId = agentId
  })

  overlay.create()
  ipcMain.on(IpcChannel.overlaySetInteractive, (_event, interactive: boolean) => {
    overlay.setInteractive(interactive)
  })

  ipcMain.on(IpcChannel.overlayAudio, (_event, pcm: string) => {
    void controller.onAudioBase64(pcm)
  })

  // Validated rather than trusted: the payload is whatever the window holding
  // the microphone chose to send, and the reducer acts on it.
  ipcMain.on(IpcChannel.overlayEvent, (_event, payload: unknown) => {
    if (isOverlayEvent(payload)) controller.onEvent(payload)
  })

  ipcMain.on(IpcChannel.overlayHover, (_event, hovered: boolean) => {
    controller.setHovered(hovered)
  })

  /**
   * The microphone belongs to the overlay and to nothing else.
   *
   * Electron grants permission requests by default, which would leave every
   * window in the app able to open the microphone. Denying everything else
   * outright means a future feature that needs a permission fails at a line
   * that says why, rather than quietly inheriting an allow-all.
   */
  const allowMicrophone = (contents: { id: number }, permission: string): boolean =>
    permission === 'media' && overlay.owns(contents)

  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    callback(allowMicrophone(contents, permission))
  })
  session.defaultSession.setPermissionCheckHandler((contents, permission) =>
    contents ? allowMicrophone(contents, permission) : false
  )

  await refreshHotkeys()

  // Warm the speech model so the first utterance is not waiting on it. Only
  // when voice input is on: this pulls 147 MB of weights into the sidecar,
  // which is pure waste for anyone who never uses the feature.
  if (settings.voiceInputEnabled) {
    voice
      .sttStatus()
      .then((status) => (status.installed ? voice.loadStt() : undefined))
      .catch((error) => console.warn('Could not warm the speech model:', error))
  }

  // Agent files are hand-editable, so edits made outside the app must show up
  // without a restart — including a per-agent hotkey added in an editor.
  store
    .startWatching(() => {
      broadcastAgentsChanged()
      void refreshHotkeys()
    })
    .catch((error) => {
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
  hotkeys.dispose()
  controller.dispose()
  voice.stop()
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
