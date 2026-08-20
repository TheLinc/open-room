import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  Notification,
  session,
  systemPreferences
} from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  broadcastAgentsChanged,
  broadcastHotkeyFailures,
  broadcastMicrophoneLevel,
  broadcastMicrophones,
  broadcastPermissionRequest,
  broadcastPermissionResolved,
  broadcastQuota,
  broadcastRuntime,
  broadcastTranscript,
  broadcastSettingsChanged,
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
import { WakeController } from './wake-controller'
import { wakeAction } from './wake-refresh'
import { MicrophoneTest } from './microphone-test'
import { AppTray } from './tray'
import { IpcChannel } from '@shared/ipc'
import type { RateLimitStatus } from '@shared/agent-runtime'
import { pipsFor } from '@shared/pips'
import { describeQuota, quotaSeverity, shouldNotifyQuota } from '@shared/quota'
import { decodePcm } from '@shared/pcm'
import {
  isOverlayEvent,
  type MicrophoneDevice,
  type OverlayHitBox,
  type PipEntry
} from '@shared/voice-input'

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
const voice = new VoiceSidecar(voiceScript, () => void primeSpeech())
const speech = new SpeechBus(new VoiceSink(voice, new NotificationSink(), store))

/**
 * Primes the speech path so the first thing an agent says sounds prompt.
 *
 * Two separate costs, both paid once per sidecar process rather than once per
 * app launch, which is why this hangs off the sidecar starting rather than
 * off `whenReady`. Warming the scripts is silent and takes about 1.6s on
 * Windows; loading Kokoro's weights takes about a second more and 163 MB, so
 * it happens only when an agent actually asks for that engine.
 *
 * Gated on someone having TTS switched on at all, in the same spirit as the
 * speech-model warming below: doing either for a user who never enables
 * speech is pure waste.
 */
async function primeSpeech(): Promise<void> {
  try {
    const { agents } = await store.list()
    const speaking = agents.map((agent) => agent.config.tts).filter((tts) => tts.enabled)
    if (speaking.length === 0) return

    await voice.warm()

    if (speaking.some((tts) => tts.enabled && tts.voice.provider === 'kokoro')) {
      const status = await voice.kokoroStatus()
      // Installed only: a warm-up is no place to start a 163 MB download.
      if (status.installed && !status.loaded) await voice.loadKokoro()
    }
  } catch (error) {
    // Latency, never correctness — the first utterance simply pays what this
    // would have paid.
    console.warn('Could not warm the speech path:', error)
  }
}

/**
 * Subscription quota for the whole account.
 *
 * Reported per agent by the SDK but true of the login they all share, so it
 * is held once here rather than read off whichever runtime happened to
 * receive the last event.
 */
let accountQuota: RateLimitStatus | null = null

/**
 * Records quota and surfaces it where it can actually be seen.
 *
 * The banner alone is not enough: this app expects the main window to be
 * hidden while agents work, so a stall that is only visible in a chat pane is
 * a stall nobody finds. The notification fires on a step up and nothing else
 * — the event itself arrives about once per turn.
 */
function onQuotaReported(limit: RateLimitStatus): void {
  const previous = accountQuota
  accountQuota = limit
  broadcastQuota(limit)
  void pushHud()

  if (!shouldNotifyQuota(previous, limit)) return

  const body = describeQuota(limit)
  if (!body || !Notification.isSupported()) return

  new Notification({
    title: quotaSeverity(limit) === 'reached' ? 'Agents paused' : 'Approaching usage limit',
    body,
    urgency: 'critical'
  }).show()
}

const supervisor = new AgentSupervisor(
  {
    onRuntime: (runtime) => {
      broadcastRuntime(runtime)
      void pushHud()
    },
    onTranscript: broadcastTranscript,
    onPermissionRequest: (request) => {
      broadcastPermissionRequest(request)
      void pushHud()
    },
    onPermissionResolved: (requestId) => {
      broadcastPermissionResolved(requestId)
      void pushHud()
    },
    onTranscriptCleared: broadcastTranscriptCleared,
    onQuota: onQuotaReported
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

/** The main window, so the HUD can raise it and know whether to show at all. */
let mainWindow: BrowserWindow | null = null

/**
 * Set only by an explicit quit.
 *
 * Closing the window hides it — the app is tray-resident, and a global hotkey
 * whose point is working while backgrounded cannot depend on a window being
 * open. This is what tells the close handler that this time it is for real.
 */
let quitting = false

const tray = new AppTray()

/** The last computed HUD entries, so the tray can be updated without re-reading disk. */
let lastPips: PipEntry[] = []

/** Whether a voice capture is open, which the tray icon has to show. */
let capturing = false

/**
 * Input devices, as the overlay last enumerated them.
 *
 * Cached here because the settings dialog lives in a window with no
 * microphone permission, and so cannot enumerate labelled devices itself.
 */
let microphones: MicrophoneDevice[] = []

/**
 * Pushes the working HUD.
 *
 * Nothing is shown while the main window is focused: the sidebar already says
 * which agents are working, and a second copy floating over it is noise. The
 * HUD exists for the case the sidebar cannot cover — the window closed to the
 * tray, or behind whatever the user is actually doing.
 */
async function pushHud(): Promise<void> {
  const { agents } = await store.list()
  lastPips = pipsFor(
    agents,
    supervisor.allRuntimes(),
    supervisor.blockedAgentIds(),
    quotaSeverity(accountQuota) === 'reached'
  )

  const focused = mainWindow !== null && !mainWindow.isDestroyed() && mainWindow.isFocused()
  overlay.sendPips(focused ? [] : lastPips)
  syncTray()
}

/**
 * The tray reflects what is true, not what is visible.
 *
 * Unlike the HUD it keeps reporting while the main window is focused: an icon
 * that flicked to idle because you looked at the app would be worse than no
 * icon. Listening outranks everything — an invisible app with an open
 * microphone is the one state that must always be legible.
 */
function syncTray(): void {
  tray.setState(
    capturing
      ? 'listening'
      : lastPips.some((pip) => pip.state === 'needs-attention')
        ? 'attention'
        : lastPips.length > 0
          ? 'working'
          : 'idle'
  )
}

/** Brings the window back, recreating it if it was destroyed rather than hidden. */
function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }

  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/** The tray's voice toggle. The settings dialog is the other way in. */
async function toggleVoiceInput(): Promise<void> {
  const settings = await store.readSettings()
  const enabled = !settings.voiceInputEnabled

  const next = { ...settings, voiceInputEnabled: enabled }
  await store.writeSettings(next)
  tray.setVoiceEnabled(enabled)

  // The settings dialog may be open on the old value. Without this it would
  // show the wrong state and write it straight back on the next save.
  broadcastSettingsChanged(next)
  await refreshHotkeys()
}

const hotkeys = new HotkeyManager((agentId) => void controller.onTrigger(agentId))

const controller = new VoiceController({
  // Wrapped so the tray learns about a capture. Everything else about the
  // overlay is the window's own business.
  overlay: {
    send: (state) => {
      overlay.send(state)

      const open = state.phase === 'listening' || state.phase === 'transcribing'
      if (open === capturing) return
      capturing = open
      syncTray()
    },
    hide: () => overlay.hide()
  },
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

const wake = new WakeController({
  overlay,
  sidecar: voice,
  supervisor,
  listAgents: async () => (await store.list()).agents,
  nowSpeaking: () => speech.speakingText,
  // A bare "hey <name>" is an address with nothing to do yet, so it opens a
  // capture — the same one the hotkey opens — rather than sending nothing.
  startCapture: (agentId) => void controller.onTrigger(agentId)
})

// Suppressing the listener while the app speaks is the cheaper of the two
// runtime self-trigger defences; the echo check covers what is already in
// flight when this fires.
speech.onSpeakingChange = (speaking) => wake.setSpeaking(speaking)

/** The device the wake listener's current stream was opened on. */
let lastMicrophoneId: string | null = null

/**
 * Starts or stops always-on listening to match the settings.
 *
 * Gated on the speech model as well as the flag: wake words with nothing to
 * transcribe would hold the microphone open for no reason at all.
 */
async function refreshWake(): Promise<void> {
  const settings = await store.readSettings()

  const deviceChanged = lastMicrophoneId !== null && settings.microphoneId !== lastMicrophoneId
  lastMicrophoneId = settings.microphoneId
  overlay.setMicrophone(settings.microphoneId)

  const action = wakeAction({
    enabled: settings.wakeWordEnabled,
    modelInstalled: (await voice.sttStatus().catch(() => null))?.installed ?? false,
    listening: wake.isListening,
    deviceChanged
  })

  if (action === 'none') return
  if (action === 'stop') {
    wake.stop()
    return
  }

  // A restart is a stop and a start: the overlay applies a new device id to
  // the next stream it opens, never to one already running.
  if (action === 'restart') wake.stop()

  await voice.loadVad().catch((error) => console.warn('Could not load the VAD model:', error))
  wake.start()
}

/** The settings microphone test; see `MicrophoneTest` for why it self-stops. */
const micTest = new MicrophoneTest({
  startMeter: () => overlay.startMeter(),
  stopMeter: () => overlay.stopMeter(),
  onLevel: broadcastMicrophoneLevel
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
  broadcastHotkeyFailures(hotkeyFailures)

  for (const failure of hotkeyFailures) {
    console.warn(`Hotkey ${failure.accelerator} could not be registered: ${failure.reason}`)
  }
}

/**
 * The app-drawn title bar's height, shared with the renderer's `TitleBar`.
 *
 * Windows draws the caption buttons into a band of exactly this height, so a
 * disagreement between the two leaves the buttons overhanging the strip.
 */
const TITLE_BAR_HEIGHT = 40

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0a0a0a',
    // The OS caption bar cannot be coloured: Windows paints it in the user's
    // accent colour, and a pale grey the moment the window loses focus. The
    // app draws its own strip instead (`TitleBar`) and keeps the native
    // buttons, tinted to match — which is what `titleBarOverlay` controls.
    // Its height has to agree with that component's, or the buttons sit
    // proud of the strip they are drawn on.
    titleBarStyle: 'hidden',
    ...(process.platform === 'win32'
      ? {
          titleBarOverlay: {
            color: '#0a0a0a',
            symbolColor: '#fafafa',
            height: TITLE_BAR_HEIGHT
          }
        }
      : // macOS has no overlay API; the traffic lights are positioned into
        // the strip instead, and TitleBar reserves the room they need.
        { trafficLightPosition: { x: 12, y: (TITLE_BAR_HEIGHT - 16) / 2 } }),
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
    mainWindow?.show()
  })

  // Focus, not just visibility: a window sitting behind a full-screen editor
  // is exactly as useful as a closed one for noticing a blocked agent.
  const onWindowVisibilityChange = (): void => void pushHud()
  mainWindow.on('focus', onWindowVisibilityChange)
  mainWindow.on('blur', onWindowVisibilityChange)
  mainWindow.on('show', onWindowVisibilityChange)
  mainWindow.on('hide', onWindowVisibilityChange)
  mainWindow.on('minimize', onWindowVisibilityChange)
  mainWindow.on('restore', onWindowVisibilityChange)

  // Closing hides. Quitting is an explicit act, from the tray or the OS —
  // otherwise the first instinct everyone has with a window (close it) would
  // silently kill every running agent.
  mainWindow.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    mainWindow?.hide()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    void pushHud()
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

/**
 * A tray-resident app is invisible, so the obvious thing to do when you want
 * it is launch it again.
 *
 * Without this that starts a second process which fails to register any global
 * hotkey (the first one holds them), adds a second tray icon, and runs its own
 * agents against the same files. Focusing what is already running is the only
 * sane response.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

app.on('second-instance', () => {
  showMainWindow()
})

app.whenReady().then(async () => {
  // Must match `appId` in electron-builder.yml: Windows only attributes a
  // toast to the app when this matches the AUMID on its Start Menu shortcut,
  // which the installer takes from that field. See the note there.
  electronApp.setAppUserModelId('dev.openroom.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const settings = await store.readSettings()
  supervisor.setOptions({ maxConcurrent: settings.maxConcurrentAgents })

  voice.start()
  registerIpcHandlers(
    store,
    supervisor,
    conversations,
    voice,
    (saved) => {
      tray.setVoiceEnabled(saved.voiceInputEnabled)
      void refreshHotkeys()
      void refreshWake()
    },
    () => accountQuota
  )
  createWindow()

  ipcMain.handle(IpcChannel.getHotkeyFailures, () => hotkeyFailures)

  ipcMain.on(IpcChannel.selectAgent, (_event, agentId: string | null) => {
    selectedAgentId = agentId
  })

  overlay.create()
  ipcMain.on(IpcChannel.overlayHitBox, (_event, box: OverlayHitBox) => {
    overlay.setHitBox(box)
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

  ipcMain.on(IpcChannel.overlayWakeSegment, (_event, pcm: string) => {
    void wake.onSegment(decodePcm(pcm))
  })

  // Talking over an agent stops it, and abandons whatever was queued behind
  // it — those lines were written for a moment that has passed.
  ipcMain.on(IpcChannel.overlayBargeIn, () => speech.bargeIn())

  ipcMain.on(IpcChannel.overlayMicrophones, (_event, devices: MicrophoneDevice[]) => {
    microphones = devices
    broadcastMicrophones(devices)
  })

  ipcMain.handle(IpcChannel.listMicrophones, () => microphones)

  // The settings microphone test. This is the one path that opens the
  // microphone without voice input being enabled, so it is bounded at both
  // ends: the user presses a button to start it, and it stops on its own if
  // they wander off with the dialog open.
  ipcMain.on(IpcChannel.setMicrophoneTest, (_event, testing: boolean) => {
    micTest.set(testing)
  })

  ipcMain.on(IpcChannel.overlayLevel, (_event, rms: number) => {
    micTest.level(rms)
  })

  // Clicking a pip is a request to *see* that agent, so the window comes
  // forward with it selected — a raised window on the wrong agent would mean
  // hunting for the one that just asked for something.
  ipcMain.on(IpcChannel.overlaySelectAgent, (_event, agentId: string) => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow()
    mainWindow?.show()
    mainWindow?.focus()
    mainWindow?.webContents.send(IpcChannel.focusAgent, agentId)
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

  tray.create({
    show: showMainWindow,
    toggleVoice: () => void toggleVoiceInput(),
    quit: () => {
      quitting = true
      app.quit()
    }
  })
  tray.setVoiceEnabled(settings.voiceInputEnabled)

  await refreshHotkeys()
  await refreshWake()
  await pushHud()

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

  // macOS: clicking the dock icon. The window is usually hidden rather than
  // destroyed now, so this shows it instead of building a second one.
  app.on('activate', showMainWindow)
})

app.on('before-quit', async (event) => {
  // Whatever asked for this — the tray, Cmd+Q, a shutdown — the window may now
  // close for real.
  quitting = true

  store.stopWatching()
  hotkeys.dispose()
  controller.dispose()
  wake.dispose()
  overlay.destroy()
  tray.destroy()
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

// There is no `window-all-closed` handler, deliberately. Open Room is
// tray-resident: closing the last window must leave the app running, with its
// agents alive and its push-to-talk hotkey still bound.
