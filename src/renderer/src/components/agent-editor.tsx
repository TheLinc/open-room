import { useEffect, useMemo, useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AlertTriangle, Download, FolderOpen, Loader2, Trash2, Volume2 } from 'lucide-react'
import {
  AGENT_COLORS,
  CLAUDE_CODE_TOOLS,
  createDefaultAgent,
  EFFORT_LEVELS,
  MODELS,
  type Agent
} from '@shared/agent'
import { checkAgentName } from '@shared/phonetics'
import type { HotkeyFailure } from '@shared/hotkeys'
import { explainAccelerator } from '@shared/accelerator'
import { HotkeyInput } from '@/components/hotkey-input'
import type { KokoroStatus, SystemVoice } from '@shared/voice-rpc'
import { DEFAULT_KOKORO_VOICE, KOKORO_VOICES } from '@shared/kokoro-voices'
import {
  agentFormSchema,
  toAgent,
  toFormValues,
  TOOL_PERMISSION_LABELS,
  type AgentFormValues,
  type ToolPermission
} from '@/lib/agent-form'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

/**
 * System voices come from the sidecar, which reports what the operating
 * system has installed. Kokoro's roster is static and lives in shared code,
 * so it can be listed before the 163 MB model has been downloaded.
 */
function useSystemVoices(enabled: boolean): SystemVoice[] {
  const [voices, setVoices] = useState<SystemVoice[]>([])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void window.openRoom.listVoices().then((list) => {
      if (!cancelled) setVoices(list)
    })
    return () => {
      cancelled = true
    }
  }, [enabled])

  return voices
}

/** Tracks whether the neural weights are present, polling while they load. */
function useKokoroStatus(enabled: boolean): KokoroStatus {
  const [status, setStatus] = useState<KokoroStatus>({ loaded: false })

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    const poll = async (): Promise<void> => {
      const next = await window.openRoom.kokoroStatus()
      if (!cancelled) setStatus(next)
    }

    void poll()
    // Polled rather than pushed: the download reports progress from inside the
    // sidecar, and a status request is far cheaper than another event channel.
    const timer = setInterval(poll, 1000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [enabled])

  return status
}

/** Radix Select rejects an empty string as a value, so "unset" needs a stand-in. */
const UNSET = '__unset__'

type Props = {
  /** Undefined creates a new agent. */
  agent?: Agent
  existingNames: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  onDeleted: () => void
  /** This agent's binding, if it could not be registered. */
  hotkeyFailure?: HotkeyFailure | null
  /** False when voice input is off, so this field cannot do anything yet. */
  voiceInputEnabled?: boolean
}

export function AgentEditor({
  agent,
  existingNames,
  open,
  onOpenChange,
  onSaved,
  onDeleted,
  hotkeyFailure,
  voiceInputEnabled = true
}: Props): React.JSX.Element {
  const isNew = agent === undefined
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const defaults = useMemo(
    () => toFormValues(agent ?? createDefaultAgent('', '', 'amber'), CLAUDE_CODE_TOOLS),
    [agent]
  )

  const form = useForm<AgentFormValues>({
    resolver: zodResolver(agentFormSchema),
    defaultValues: defaults,
    mode: 'onBlur'
  })

  // Reopening the dialog for a different agent must not show the previous
  // agent's values.
  useEffect(() => {
    if (open) {
      form.reset(defaults)
      setSaveError(null)
      setConfirmingDelete(false)
    }
  }, [open, defaults, form])

  const watchedName = form.watch('name')
  const watchedHotkey = form.watch('hotkey')
  const ttsEnabled = form.watch('ttsEnabled')
  const notificationsEnabled = form.watch('notificationsEnabled')
  const voiceProvider = form.watch('voiceProvider')
  const systemVoices = useSystemVoices(open && ttsEnabled && voiceProvider === 'system')
  const kokoro = useKokoroStatus(open && ttsEnabled && voiceProvider === 'kokoro')
  const persistSession = form.watch('persistSession')

  const nameWarnings = useMemo(
    () => checkAgentName(watchedName ?? '', existingNames),
    [watchedName, existingNames]
  )

  const onSubmit = async (values: AgentFormValues): Promise<void> => {
    setSaveError(null)
    const next = toAgent(values, agent?.config.id)
    const result = isNew
      ? await window.openRoom.createAgent(next)
      : await window.openRoom.updateAgent(next)

    if (!result.ok) {
      setSaveError(result.message)
      return
    }
    onSaved()
    onOpenChange(false)
  }

  const handleDelete = async (): Promise<void> => {
    if (!agent) return
    const result = await window.openRoom.deleteAgent(agent.config.id)
    if (!result.ok) {
      setSaveError(result.message)
      return
    }
    onDeleted()
    onOpenChange(false)
  }

  const pickWorkspace = async (): Promise<void> => {
    const picked = await window.openRoom.pickWorkspace()
    if (picked) form.setValue('workspacePath', picked, { shouldValidate: true, shouldDirty: true })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* `overflow-hidden` matters: DialogContent is a grid by default with no
          clipping, so without it the tab content paints past the rounded
          container instead of being confined to the scroll area below. */}
      <DialogContent className="flex max-h-[85vh] h-full flex-col gap-0 overflow-hidden sm:max-w-2xl px-0">
        <DialogHeader className="px-2">
          <DialogTitle>{isNew ? 'New agent' : `Edit ${agent.config.name}`}</DialogTitle>
          <DialogDescription>
            {isNew
              ? 'Give the agent a name you can say out loud, and a folder to work in.'
              : 'Changes are written to config.json and AGENT.md immediately.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col mt-2">
          <Tabs defaultValue="general" className="flex min-h-0 flex-1 flex-col">
            <div className="px-2">
              <TabsList className="w-full justify-start px-2">
                <TabsTrigger value="general">General</TabsTrigger>
                <TabsTrigger value="permissions">Permissions</TabsTrigger>
                <TabsTrigger value="context">Context</TabsTrigger>
                <TabsTrigger value="voice">Voice</TabsTrigger>
                <TabsTrigger value="advanced">Advanced</TabsTrigger>
              </TabsList>
            </div>

            {/* Native overflow rather than ScrollArea: Radix's viewport sizes
                itself with a percentage height, which does not resolve against
                a flex-sized parent here and lets content paint over the
                footer. A plain scroll container in a `min-h-0` flex child is
                the dependable form. */}
            {/* No negative margin here: pairing `-mx-1` with `px-1` makes this
                wider than its parent and produces a stray horizontal scrollbar. */}
            <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2">
              <div className="py-2">
                <TabsContent value="general" className="mt-0 flex flex-col gap-5">
                  <Field>
                    <FieldLabel htmlFor="name">Name</FieldLabel>
                    <Input id="name" placeholder="Atlas" {...form.register('name')} />
                    <FieldDescription>
                      What you call this agent. It will also be its wake word once wake words ship;
                      for now, address it with a push-to-talk shortcut.
                    </FieldDescription>
                    <FieldError errors={[form.formState.errors.name]} />
                    {nameWarnings.map((warning) => (
                      <p
                        key={warning.kind}
                        className="flex items-start gap-1.5 text-sm text-amber-500"
                      >
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                        {warning.message}
                      </p>
                    ))}
                  </Field>

                  <Field>
                    <FieldLabel>Colour</FieldLabel>
                    <Controller
                      control={form.control}
                      name="color"
                      render={({ field }) => (
                        <div className="flex flex-wrap gap-2">
                          {AGENT_COLORS.map((color) => (
                            <button
                              key={color.id}
                              type="button"
                              aria-label={color.id}
                              aria-pressed={field.value === color.id}
                              onClick={() => field.onChange(color.id)}
                              className={cn(
                                'size-7 rounded-full border-2 transition-transform',
                                field.value === color.id
                                  ? 'border-foreground scale-110'
                                  : 'border-transparent hover:scale-105'
                              )}
                              style={{ backgroundColor: color.hex }}
                            />
                          ))}
                        </div>
                      )}
                    />
                    <FieldDescription>
                      Identifies the agent in the sidebar and while it is listening.
                    </FieldDescription>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="workspacePath">Workspace folder</FieldLabel>
                    <div className="flex gap-2">
                      <Input
                        id="workspacePath"
                        placeholder="Choose a folder…"
                        {...form.register('workspacePath')}
                      />
                      <Button type="button" variant="outline" onClick={pickWorkspace}>
                        <FolderOpen /> Browse
                      </Button>
                    </div>
                    <FieldDescription>
                      The agent runs here, exactly as Claude Code would in that directory.
                    </FieldDescription>
                    <FieldError errors={[form.formState.errors.workspacePath]} />
                  </Field>

                  <Field>
                    <FieldLabel>Model</FieldLabel>
                    <Controller
                      control={form.control}
                      name="model"
                      render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {MODELS.map((model) => (
                              <SelectItem key={model.id} value={model.id}>
                                {model.label} — {model.hint}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </Field>

                  <div className="grid grid-cols-2 gap-4">
                    <Field>
                      <FieldLabel>Reasoning effort</FieldLabel>
                      <Controller
                        control={form.control}
                        name="effort"
                        render={({ field }) => (
                          // Radix Select cannot hold an empty string, so
                          // "unset" travels as a sentinel and is mapped back.
                          <Select
                            value={field.value || UNSET}
                            onValueChange={(next) => field.onChange(next === UNSET ? '' : next)}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={UNSET}>Model default</SelectItem>
                              {EFFORT_LEVELS.map((level) => (
                                <SelectItem key={level} value={level}>
                                  {level}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </Field>

                    <Field>
                      <FieldLabel>Fallback model</FieldLabel>
                      <Controller
                        control={form.control}
                        name="fallbackModel"
                        render={({ field }) => (
                          <Select
                            value={field.value || UNSET}
                            onValueChange={(next) => field.onChange(next === UNSET ? '' : next)}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={UNSET}>None</SelectItem>
                              {MODELS.map((model) => (
                                <SelectItem key={model.id} value={model.id}>
                                  {model.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                      <FieldDescription>Used if the primary model is unavailable.</FieldDescription>
                    </Field>
                  </div>
                </TabsContent>

                <TabsContent value="permissions" className="mt-0 flex flex-col gap-5">
                  <Field>
                    <FieldLabel>Permission mode</FieldLabel>
                    <Controller
                      control={form.control}
                      name="permissionMode"
                      render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="default">
                              Default — act, asking when needed
                            </SelectItem>
                            <SelectItem value="plan">
                              Plan — propose changes without making them
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </Field>

                  <Separator />

                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium">Tools</p>
                    <p className="text-sm text-muted-foreground">
                      Every tool is available to the agent. This controls whether it asks you first.
                    </p>
                  </div>

                  <Controller
                    control={form.control}
                    name="toolPermissions"
                    render={({ field }) => (
                      <div className="flex flex-col gap-2">
                        {CLAUDE_CODE_TOOLS.map((tool) => {
                          const value: ToolPermission = field.value?.[tool] ?? 'ask'
                          return (
                            <div key={tool} className="flex items-center justify-between gap-4">
                              <span className="font-mono text-sm">{tool}</span>
                              <Select
                                value={value}
                                onValueChange={(next) =>
                                  field.onChange({ ...field.value, [tool]: next })
                                }
                              >
                                <SelectTrigger className="w-48">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {(Object.keys(TOOL_PERMISSION_LABELS) as ToolPermission[]).map(
                                    (permission) => (
                                      <SelectItem key={permission} value={permission}>
                                        {TOOL_PERMISSION_LABELS[permission]}
                                      </SelectItem>
                                    )
                                  )}
                                </SelectContent>
                              </Select>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  />
                </TabsContent>

                <TabsContent value="context" className="mt-0 flex flex-col gap-5">
                  <Field>
                    <FieldLabel htmlFor="context">AGENT.md</FieldLabel>
                    <Textarea
                      id="context"
                      spellCheck={false}
                      className="min-h-[340px] font-mono text-xs"
                      {...form.register('context')}
                    />
                    <FieldDescription>
                      Appended to the Claude Code system prompt, so write it as standing
                      instructions. Persists across conversations.
                    </FieldDescription>
                  </Field>
                </TabsContent>

                <TabsContent value="voice" className="mt-0 flex flex-col gap-5">
                  <Field orientation="horizontal">
                    <div className="flex flex-col gap-1">
                      <FieldLabel htmlFor="notificationsEnabled">Show notifications</FieldLabel>
                      <FieldDescription>
                        A desktop notification when this agent reports in. Independent of speech —
                        speech is gone if you miss it, a notification stays.
                      </FieldDescription>
                    </div>
                    <Controller
                      control={form.control}
                      name="notificationsEnabled"
                      render={({ field }) => (
                        <Switch
                          id="notificationsEnabled"
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      )}
                    />
                  </Field>

                  <Separator />

                  <Field orientation="horizontal">
                    <div className="flex flex-col gap-1">
                      <FieldLabel htmlFor="ttsEnabled">Speak aloud</FieldLabel>
                      <FieldDescription>
                        Read this agent&rsquo;s updates out loud, in its own voice.
                      </FieldDescription>
                    </div>
                    <Controller
                      control={form.control}
                      name="ttsEnabled"
                      render={({ field }) => (
                        <Switch
                          id="ttsEnabled"
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      )}
                    />
                  </Field>

                  {!notificationsEnabled && !ttsEnabled && (
                    <p className="text-sm text-amber-500">
                      With both switched off this agent reports silently — its updates appear only
                      in the chat transcript.
                    </p>
                  )}

                  {ttsEnabled && (
                    <>
                      <Field>
                        <FieldLabel>Engine</FieldLabel>
                        <Controller
                          control={form.control}
                          name="voiceProvider"
                          render={({ field }) => (
                            <Select
                              value={field.value}
                              onValueChange={(next) => {
                                field.onChange(next)
                                // Voice ids are per-engine, so a leftover id
                                // from the other one would never resolve.
                                form.setValue(
                                  'voiceId',
                                  next === 'kokoro' ? DEFAULT_KOKORO_VOICE : ''
                                )
                              }}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="system">System — instant, built in</SelectItem>
                                <SelectItem value="kokoro">
                                  Neural — better quality, 163 MB download
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        />
                        <FieldDescription>
                          {voiceProvider === 'kokoro'
                            ? 'Sounds markedly more natural and is identical on Windows and macOS. Adds roughly a third of a second before each line.'
                            : 'Uses the voices already installed on this machine. Fastest to start speaking.'}
                        </FieldDescription>
                      </Field>

                      {voiceProvider === 'kokoro' && !kokoro.loaded && (
                        <div className="flex items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-sm">
                          <span className="text-amber-500">
                            {kokoro.error
                              ? `Download failed: ${kokoro.error}`
                              : kokoro.progress !== undefined && kokoro.progress < 1
                                ? `Downloading voice model… ${Math.round(kokoro.progress * 100)}%`
                                : 'Voice model not downloaded yet (163 MB, one time).'}
                          </span>
                          {kokoro.progress === undefined && (
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => void window.openRoom.loadKokoro()}
                            >
                              <Download /> Download
                            </Button>
                          )}
                        </div>
                      )}

                      <Field>
                        <FieldLabel>Voice</FieldLabel>
                        <Controller
                          control={form.control}
                          name="voiceId"
                          render={({ field }) => (
                            <div className="flex gap-2">
                              <Select
                                value={field.value || UNSET}
                                onValueChange={(next) => field.onChange(next === UNSET ? '' : next)}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Choose a voice" />
                                </SelectTrigger>
                                <SelectContent>
                                  {voiceProvider === 'system' ? (
                                    <>
                                      <SelectItem value={UNSET}>System default</SelectItem>
                                      {systemVoices.map((voice) => (
                                        <SelectItem key={voice.id} value={voice.id}>
                                          {voice.label}
                                          {voice.locale ? ` · ${voice.locale}` : ''}
                                        </SelectItem>
                                      ))}
                                    </>
                                  ) : (
                                    // Listed best-first with Kokoro's own grade
                                    // shown: the roster runs A to F, and the
                                    // weakest entries would otherwise define the
                                    // impression of the engine.
                                    KOKORO_VOICES.map((voice) => (
                                      <SelectItem key={voice.id} value={voice.id}>
                                        {voice.name} · {voice.gender} · {voice.locale} ·{' '}
                                        {voice.grade}
                                      </SelectItem>
                                    ))
                                  )}
                                </SelectContent>
                              </Select>
                              <Button
                                type="button"
                                variant="outline"
                                aria-label="Preview voice"
                                disabled={voiceProvider === 'kokoro' && !kokoro.loaded}
                                onClick={() =>
                                  void window.openRoom.previewVoice(
                                    field.value,
                                    form.getValues('rate'),
                                    voiceProvider
                                  )
                                }
                              >
                                <Volume2 /> Preview
                              </Button>
                            </div>
                          )}
                        />
                        <FieldDescription>
                          Give each speaking agent a distinct voice — it is the fastest way to tell
                          who is talking.
                        </FieldDescription>
                      </Field>

                      <Controller
                        control={form.control}
                        name="rate"
                        render={({ field }) => (
                          <Field>
                            <FieldLabel>Rate — {field.value.toFixed(2)}×</FieldLabel>
                            <Slider
                              min={0.5}
                              max={2}
                              step={0.05}
                              value={[field.value]}
                              onValueChange={([next]) => field.onChange(next)}
                            />
                          </Field>
                        )}
                      />
                    </>
                  )}
                </TabsContent>

                <TabsContent value="advanced" className="mt-0 flex flex-col gap-5">
                  <Field>
                    <FieldLabel htmlFor="mcpServersJson">MCP servers</FieldLabel>
                    <Textarea
                      id="mcpServersJson"
                      spellCheck={false}
                      placeholder={'{\n  "my-server": { "command": "npx", "args": ["-y", "…"] }\n}'}
                      className="min-h-[180px] font-mono text-xs"
                      {...form.register('mcpServersJson')}
                    />
                    <FieldDescription>
                      Same shape as Claude Code’s <code>.mcp.json</code>. Leave empty for none.
                    </FieldDescription>
                    <FieldError errors={[form.formState.errors.mcpServersJson]} />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="hotkey">Push-to-talk shortcut</FieldLabel>
                    <Controller
                      control={form.control}
                      name="hotkey"
                      render={({ field }) => (
                        <HotkeyInput
                          id="hotkey"
                          value={field.value ?? ''}
                          onChange={field.onChange}
                          placeholder="Click, then press a shortcut for this agent"
                        />
                      )}
                    />
                    {!voiceInputEnabled ? (
                      <FieldDescription className="text-amber-500">
                        Voice input is off, so this shortcut will not do anything yet. Turn it on in
                        Settings.
                      </FieldDescription>
                    ) : explainAccelerator(watchedHotkey ?? '') ? (
                      <FieldDescription className="text-destructive">
                        {explainAccelerator(watchedHotkey ?? '')}
                      </FieldDescription>
                    ) : hotkeyFailure ? (
                      <FieldDescription className="text-destructive">
                        {hotkeyFailure.reason}
                      </FieldDescription>
                    ) : (
                      <FieldDescription>
                        Optional. Talks to this agent directly, whichever one is selected. Leave
                        empty to use the global shortcut.
                      </FieldDescription>
                    )}
                  </Field>

                  <Separator />

                  <Field orientation="horizontal">
                    <div className="flex flex-col gap-1">
                      <FieldLabel htmlFor="persistSession">Remember conversations</FieldLabel>
                      <FieldDescription>
                        {persistSession
                          ? 'Conversations are saved and can be resumed later.'
                          : 'Nothing is written to disk — no conversation history, and no recovery if the app or agent crashes.'}
                      </FieldDescription>
                    </div>
                    <Controller
                      control={form.control}
                      name="persistSession"
                      render={({ field }) => (
                        <Switch
                          id="persistSession"
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      )}
                    />
                  </Field>
                </TabsContent>
              </div>
            </div>
          </Tabs>

          {saveError && (
            <p role="alert" className="pb-2 text-sm text-destructive">
              {saveError}
            </p>
          )}

          {/* Two direct children, deliberately: `sm:justify-between` is what
              pushes Delete away from Cancel and Save, and it has nothing to
              space apart if both are wrapped in one element. `mx-0` undoes the
              footer's own `-mx-4`, which exists to cancel the dialog's
              horizontal padding — with that padding now zero it would instead
              hang the band a clear 16px past each edge, to be clipped. */}
          <DialogFooter className="mx-0 border-t px-2 pt-4 sm:justify-between">
            {isNew ? (
              <span />
            ) : (
              <Button
                type="button"
                variant={confirmingDelete ? 'destructive' : 'ghost'}
                onClick={() => (confirmingDelete ? handleDelete() : setConfirmingDelete(true))}
                onBlur={() => setConfirmingDelete(false)}
              >
                <Trash2 />
                {confirmingDelete ? 'Click again to delete' : 'Delete'}
              </Button>
            )}

            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Loader2 className="animate-spin" />}
                {isNew ? 'Create agent' : 'Save changes'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
