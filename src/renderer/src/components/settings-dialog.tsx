import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { findEntry, formatBytes, totalBytes } from '@shared/model-catalog'
import type { HotkeyFailure } from '@shared/hotkeys'
import type { MicrophoneDevice } from '@shared/voice-input'
import type { SttStatus } from '@shared/voice-rpc'
import { useSettings } from '@/hooks/use-settings'
import { useStaticDialog } from '@/hooks/use-static-dialog'
import { explainAccelerator } from '@shared/accelerator'
import { HotkeyInput } from '@/components/hotkey-input'
import { MicMeter } from '@/components/mic-meter'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

/** The only speech model Phase 5a wires up. */
const STT_MODEL_ID = 'whisper-tiny-en'

/** Radix Select cannot hold an empty string, and empty is "system default". */
const SYSTEM_DEFAULT = '__default__'

/**
 * Chromium reports two aliases for the system default alongside the real
 * devices. Listing them would offer "Default - Microphone (Webcam)" beside
 * the same webcam again, which is three ways of saying two things.
 */
const ALIASES = new Set(['default', 'communications'])

/** Windows appends a USB vendor:product pair that means nothing to a user. */
function deviceLabel(label: string): string {
  return label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim()
}

export function SettingsDialog({
  open,
  onOpenChange,
  hotkeyFailures
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  hotkeyFailures: HotkeyFailure[]
}): React.JSX.Element {
  const { settings, save, error } = useSettings()
  const staticDialog = useStaticDialog()
  const [stt, setStt] = useState<SttStatus | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [microphones, setMicrophones] = useState<MicrophoneDevice[]>([])

  // Re-read on open: the model can be installed from elsewhere, and a stale
  // "not installed" would keep the switch disabled for no reason. Devices
  // change even more freely — headsets appear and vanish.
  useEffect(() => {
    if (!open) return
    void window.openRoom.sttStatus().then(setStt)
    void window.openRoom.listMicrophones().then(setMicrophones)
  }, [open])

  // Pushed as well as polled: the overlay enumerates, so the list can arrive
  // after this opened, and devices come and go while it is open.
  useEffect(() => window.openRoom.onMicrophonesChanged(setMicrophones), [])

  // The editor command is free text, and every other field here saves on
  // change. Doing that per keystroke writes settings.json and re-registers
  // the global hotkeys once per character, so this one is held locally and
  // written after a pause (or on blur). Null means "showing the saved value".
  const [editorDraft, setEditorDraft] = useState<string | null>(null)
  const flushEditor = useCallback((): void => {
    if (editorDraft === null || !settings) return
    if (editorDraft !== settings.editorCommand) {
      void save({ ...settings, editorCommand: editorDraft })
    }
    setEditorDraft(null)
  }, [editorDraft, settings, save])
  useEffect(() => {
    if (editorDraft === null) return
    const timer = setTimeout(flushEditor, 400)
    return () => clearTimeout(timer)
  }, [editorDraft, flushEditor])

  // Polled rather than pushed: the download runs in the sidecar, and a status
  // call is cheap next to fetching 154 MB.
  useEffect(() => {
    if (!downloading) return

    const timer = setInterval(() => {
      void window.openRoom.sttStatus().then(setStt)
    }, 500)
    return () => clearInterval(timer)
  }, [downloading])

  const entry = findEntry(STT_MODEL_ID)
  const installed = stt?.installed ?? false
  const globalFailure = hotkeyFailures.find((failure) => failure.agentId === null)

  /**
   * Which switch is waiting on the model download offer. The switches used
   * to be disabled until Whisper was installed, with the download at the
   * bottom of the dialog — a dead control with its explanation somewhere
   * else, which read as broken. Flipping one now offers the download in
   * place; declining cancels the enable (the setting was never written).
   */
  const [pendingEnable, setPendingEnable] = useState<'ptt' | 'wake' | null>(null)

  // The download takes minutes and other settings can change during it, so
  // the completion save must not write back a stale copy from its closure.
  const settingsRef = useRef(settings)
  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  const enable = (which: 'ptt' | 'wake', on: boolean): void => {
    const current = settingsRef.current
    if (!current) return
    void save(
      which === 'ptt' ? { ...current, voiceInputEnabled: on } : { ...current, wakeWordEnabled: on }
    )
  }

  const requestEnable = (which: 'ptt' | 'wake', on: boolean): void => {
    setEnableError(null)
    // Turning off never needs the model, and with it installed there is
    // nothing to ask.
    if (!on || installed) {
      setPendingEnable(null)
      enable(which, on)
      return
    }
    setPendingEnable(which)
  }

  // Set while a download accepted from a toggle is running, so the voice
  // section shows its progress there and the switch can flip on when it
  // lands. A download started from the model card below stays down there.
  const [completing, setCompleting] = useState<'ptt' | 'wake' | null>(null)
  // A failure of that download, shown beside the switches that asked for it.
  const [enableError, setEnableError] = useState<string | null>(null)

  const download = async (): Promise<boolean> => {
    setDownloading(true)
    setDownloadError(null)

    const result = await window.openRoom.loadSttModel()

    setDownloading(false)
    setStt(await window.openRoom.sttStatus())
    if (!result.ok) setDownloadError(result.message)
    return result.ok
  }

  const acceptDownload = async (): Promise<void> => {
    const which = pendingEnable
    setPendingEnable(null)
    if (!which) return

    setCompleting(which)
    setEnableError(null)
    const ok = await download()
    setCompleting(null)

    // Finish what the toggle started; a download that fails leaves the
    // switch exactly where it was, with the failure shown where it happened.
    if (ok) enable(which, true)
    else setEnableError('The download failed — the switch was left off. Details below.')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* DialogContent is a grid and does not clip by default. Static
          backdrop: outside clicks pulse rather than close, the same as the
          agent editor — settings save on change, so nothing is lost either
          way, but the two dialogs must not disagree about what a click
          beside them means. */}
      <DialogContent
        {...staticDialog}
        className="flex max-h-[80vh] flex-col overflow-hidden sm:max-w-lg px-0"
      >
        <DialogHeader className="px-2">
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        {!settings ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          // Plain overflow div, not ScrollArea — see CLAUDE.md's gotcha about
          // ScrollArea inside a flex-sized parent.
          <div className="min-h-0 flex-1 space-y-8 overflow-x-hidden overflow-y-auto px-2">
            <section className="space-y-4">
              <h3 className="text-sm font-medium">Agents</h3>

              <div className="space-y-2">
                <Label>Maximum running at once — {settings.maxConcurrentAgents}</Label>
                <Slider
                  min={1}
                  max={12}
                  step={1}
                  value={[settings.maxConcurrentAgents]}
                  onValueChange={([value]) =>
                    void save({ ...settings, maxConcurrentAgents: value })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Each running agent is a full Claude Code subprocess, so this is a memory ceiling
                  as much as a usage one.
                </p>
              </div>

              <div className="space-y-2">
                <Label>
                  Tear down idle sessions after —{' '}
                  {settings.idleTimeoutMinutes === 0
                    ? 'never'
                    : `${settings.idleTimeoutMinutes} minutes`}
                </Label>
                <Slider
                  min={0}
                  max={240}
                  step={5}
                  value={[settings.idleTimeoutMinutes]}
                  onValueChange={([value]) => void save({ ...settings, idleTimeoutMinutes: value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="editor">Open files with</Label>
                <Input
                  id="editor"
                  value={editorDraft ?? settings.editorCommand}
                  placeholder="code -g {path}:{line}"
                  onChange={(e) => setEditorDraft(e.target.value)}
                  onBlur={flushEditor}
                />
                <p className="text-xs text-muted-foreground">
                  A command; {'{path}'} and {'{line}'} are filled in. Leave empty to use whatever
                  opens the file type.
                </p>
              </div>
            </section>

            <section className="space-y-4">
              <h3 className="text-sm font-medium">Voice input</h3>

              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <Label htmlFor="voice-input">Enable push-to-talk</Label>
                  <p className="text-xs text-muted-foreground">
                    An open microphone is a control channel into a tool with shell and file-write
                    access. Enabling it is a deliberate act.
                  </p>
                </div>
                <Switch
                  id="voice-input"
                  checked={settings.voiceInputEnabled}
                  // Not disabled while the model is missing: the switch is
                  // how the download gets offered. It stays off until the
                  // model is actually installed, so a shortcut that cannot
                  // work still never exists.
                  disabled={downloading}
                  onCheckedChange={(checked) => requestEnable('ptt', checked)}
                />
              </div>

              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <Label htmlFor="wake-word">Wake words</Label>
                  <p className="text-xs text-muted-foreground">
                    Keeps the microphone open and listens for “Hey {'{agent}'}”. Unlike push-to-talk
                    this is an open channel: anyone within earshot, or a video playing nearby, can
                    address an agent.
                  </p>
                </div>
                <Switch
                  id="wake-word"
                  checked={settings.wakeWordEnabled}
                  // Independent of push-to-talk on purpose: each is its own
                  // opt-in, and gating this on the other made hands-free-only
                  // use impossible — while turning push-to-talk off greyed
                  // this out with the microphone still open behind it.
                  disabled={downloading}
                  onCheckedChange={(checked) => requestEnable('wake', checked)}
                />
              </div>

              {pendingEnable && entry && (
                <div className="space-y-2 rounded-lg border border-border p-3">
                  <p className="text-sm">
                    {pendingEnable === 'ptt' ? 'Push-to-talk needs' : 'Wake words need'} the{' '}
                    {entry.label} speech model — a one-time {formatBytes(totalBytes(entry))}{' '}
                    download. It runs entirely on this machine; nothing you say is sent anywhere.
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => void acceptDownload()}>
                      <Download />
                      Download and enable
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setPendingEnable(null)}>
                      Not now
                    </Button>
                  </div>
                </div>
              )}

              {completing && (
                <div className="space-y-1">
                  <Progress value={(stt?.progress ?? 0) * 100} />
                  <p className="text-xs text-muted-foreground">
                    Downloading the speech model — the switch flips on when it lands.
                  </p>
                </div>
              )}
              {enableError && <p className="text-xs text-destructive">{enableError}</p>}

              <div className="space-y-2">
                <Label htmlFor="microphone">Microphone</Label>
                <Select
                  value={settings.microphone || SYSTEM_DEFAULT}
                  onValueChange={(value) =>
                    void save({
                      ...settings,
                      microphone: value === SYSTEM_DEFAULT ? '' : value
                    })
                  }
                >
                  <SelectTrigger id="microphone" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SYSTEM_DEFAULT}>System default</SelectItem>
                    {microphones
                      .filter((device) => device.label && !ALIASES.has(device.deviceId))
                      .map((device) => (
                        <SelectItem key={device.deviceId} value={device.label}>
                          {deviceLabel(device.label)}
                        </SelectItem>
                      ))}
                    {settings.microphone &&
                      !microphones.some((device) => device.label === settings.microphone) && (
                        // Keep an unplugged selection visible: a Select whose
                        // value matches no item paints blank, which reads as
                        // "nothing chosen" rather than "your headset is off".
                        <SelectItem value={settings.microphone}>
                          {deviceLabel(settings.microphone)} (not connected)
                        </SelectItem>
                      )}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {microphones.length > 1
                    ? 'The system default is often not the one you talk into.'
                    : 'Whatever this machine is set to use for input.'}
                </p>
                <MicMeter />
              </div>

              <div className="space-y-2">
                <Label htmlFor="ptt">Push-to-talk shortcut</Label>
                <HotkeyInput
                  id="ptt"
                  value={settings.pushToTalkHotkey}
                  onChange={(accelerator) =>
                    void save({ ...settings, pushToTalkHotkey: accelerator })
                  }
                />
                {explainAccelerator(settings.pushToTalkHotkey) ? (
                  <p className="text-xs text-destructive">
                    {explainAccelerator(settings.pushToTalkHotkey)}
                  </p>
                ) : globalFailure ? (
                  <p className="text-xs text-destructive">{globalFailure.reason}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Press once to start talking, again to send. Esc discards.
                  </p>
                )}
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-medium">Speech model</h3>

              {entry && (
                <div className="space-y-2 rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm">{entry.label}</p>
                      <p className="text-xs break-words text-muted-foreground">
                        {formatBytes(totalBytes(entry))} · {entry.license} · {entry.attribution}
                      </p>
                    </div>
                    {installed ? (
                      <span className="shrink-0 text-xs text-muted-foreground">Installed</span>
                    ) : (
                      <Button
                        size="sm"
                        className="shrink-0"
                        disabled={downloading}
                        onClick={() => void download()}
                      >
                        {downloading ? <Loader2 className="animate-spin" /> : <Download />}
                        {downloading ? 'Downloading…' : 'Download'}
                      </Button>
                    )}
                  </div>

                  {downloading && <Progress value={(stt?.progress ?? 0) * 100} />}
                  {(downloadError ?? stt?.error) && (
                    <p className="text-xs text-destructive">{downloadError ?? stt?.error}</p>
                  )}
                  {!installed && !downloading && (
                    <p className="text-xs text-muted-foreground">
                      Voice input stays off until this is installed — flipping either switch above
                      offers the download too. It runs entirely on this machine; nothing you say is
                      sent anywhere.
                    </p>
                  )}
                </div>
              )}
            </section>

            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
