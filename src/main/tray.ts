import { Menu, Tray, nativeImage } from 'electron'
import idleIcon from '../../resources/tray-idle.png?asset'
import activeIcon from '../../resources/tray-active.png?asset'
import attentionIcon from '../../resources/tray-attention.png?asset'

/**
 * The app's presence when no window is open.
 *
 * Tray residency is what makes a global push-to-talk hotkey worth having — a
 * shortcut whose whole point is working while the app is backgrounded is
 * undermined if closing the window quits.
 *
 * The icon reflects state because tray residency plus a microphone is the
 * version of the open-mic concern with the least feedback: an app that is
 * invisible and listening. "Is it hot?" has to be answerable at a glance.
 */

export type TrayState = 'idle' | 'listening' | 'working' | 'attention'

export type TrayHandlers = {
  show: () => void
  toggleVoice: () => void
  quit: () => void
}

/**
 * Icons are imported rather than resolved at runtime.
 *
 * `?asset` is how the existing window icon is handled: electron-vite emits the
 * file into the bundle and rewrites this to its real path, which works in dev
 * and packaged alike. Joining against `process.resourcesPath` would have to
 * account for `asarUnpack` and would break silently when it did not.
 */
const ICONS: Record<TrayState, string> = {
  idle: idleIcon,
  listening: activeIcon,
  working: activeIcon,
  attention: attentionIcon
}

const TOOLTIPS: Record<TrayState, string> = {
  idle: 'Open Room',
  listening: 'Open Room — listening',
  working: 'Open Room — working',
  attention: 'Open Room — an agent needs you'
}

export class AppTray {
  private tray: Tray | null = null
  private state: TrayState = 'idle'
  private voiceEnabled = false
  private handlers: TrayHandlers | null = null

  create(handlers: TrayHandlers): void {
    this.handlers = handlers
    this.tray = new Tray(this.iconFor('idle'))
    this.tray.setToolTip(TOOLTIPS.idle)

    // Windows opens the context menu on right-click already; a left click
    // should do the obvious thing rather than nothing.
    this.tray.on('click', handlers.show)
    this.render()
  }

  setState(state: TrayState): void {
    if (state === this.state) return
    this.state = state

    this.tray?.setImage(this.iconFor(state))
    this.tray?.setToolTip(TOOLTIPS[state])
  }

  setVoiceEnabled(enabled: boolean): void {
    if (enabled === this.voiceEnabled) return
    this.voiceEnabled = enabled
    this.render()
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }

  /**
   * The menu is rebuilt rather than mutated: Electron's menu items are
   * immutable once built, so a checkbox that has to reflect state has no other
   * way to change.
   */
  private render(): void {
    if (!this.tray || !this.handlers) return

    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Show Open Room', click: this.handlers.show },
        { type: 'separator' },
        {
          label: 'Voice input',
          type: 'checkbox',
          checked: this.voiceEnabled,
          click: this.handlers.toggleVoice
        },
        { type: 'separator' },
        { label: 'Quit Open Room', click: this.handlers.quit }
      ])
    )
  }

  private iconFor(state: TrayState): Electron.NativeImage {
    const image = nativeImage.createFromPath(ICONS[state])

    // macOS renders a template image in the menu bar's own colour, which is
    // the only way to be legible in both a light and a dark menu bar. The
    // icons are white with an alpha channel; template mode uses only alpha.
    if (process.platform === 'darwin') image.setTemplateImage(true)
    return image
  }
}
