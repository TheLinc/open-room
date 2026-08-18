import { useEffect, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { findEntry, formatBytes, totalBytes } from '@shared/model-catalog'
import type { HotkeyFailure } from '@shared/hotkeys'
import type { SttStatus } from '@shared/voice-rpc'
import { useSettings } from '@/hooks/use-settings'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'

/** The only speech model Phase 5a wires up. */
const STT_MODEL_ID = 'whisper-tiny-en'

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
  const [stt, setStt] = useState<SttStatus | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  /**
   * The shortcut is held locally until committed.
   *
   * Saving per keystroke would re-register on every character and report
   * "Invalid accelerator" for every prefix of a valid one, while writing that
   * garbage to disk on the way through.
   */
  const [hotkeyDraft, setHotkeyDraft] = useState<string | null>(null)

  // Re-read on open: the model can be installed from elsewhere, and a stale
  // "not installed" would keep the switch disabled for no reason.
  useEffect(() => {
    if (!open) return
    void window.openRoom.sttStatus().then(setStt)
  }, [open])

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

  const download = async (): Promise<void> => {
    setDownloading(true)
    setDownloadError(null)

    const result = await window.openRoom.loadSttModel()

    setDownloading(false)
    setStt(await window.openRoom.sttStatus())
    if (!result.ok) setDownloadError(result.message)
  }

  const commitHotkey = (): void => {
    if (hotkeyDraft === null || !settings) return
    const next = hotkeyDraft.trim()
    setHotkeyDraft(null)
    if (next !== settings.pushToTalkHotkey) void save({ ...settings, pushToTalkHotkey: next })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* DialogContent is a grid and does not clip by default. */}
      <DialogContent className="flex max-h-[80vh] flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        {!settings ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          // Plain overflow div, not ScrollArea — see CLAUDE.md's gotcha about
          // ScrollArea inside a flex-sized parent.
          <div className="min-h-0 flex-1 space-y-8 overflow-x-hidden overflow-y-auto pr-1">
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
                  // A shortcut that exists but cannot possibly work is worse
                  // than no shortcut, so this is the gate on the whole feature.
                  disabled={!installed}
                  onCheckedChange={(checked) =>
                    void save({ ...settings, voiceInputEnabled: checked })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="ptt">Push-to-talk shortcut</Label>
                <Input
                  id="ptt"
                  value={hotkeyDraft ?? settings.pushToTalkHotkey}
                  onChange={(event) => setHotkeyDraft(event.target.value)}
                  onBlur={commitHotkey}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                  }}
                />
                {globalFailure ? (
                  <p className="text-xs text-destructive">{globalFailure.reason}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Electron accelerator form, e.g. <code>CommandOrControl+Shift+Space</code>. Press
                    once to start, again to send; Esc discards.
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
                      Voice input stays off until a model is installed. It runs entirely on this
                      machine — nothing you say is sent anywhere.
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
