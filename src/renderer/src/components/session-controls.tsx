import { useState } from 'react'
import { ChevronDown, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { EFFORT_LEVELS, MODELS, type AgentConfig } from '@shared/agent'
import {
  effectiveSettings,
  permissionModeNotice,
  overriddenFields,
  SESSION_PERMISSION_MODES,
  type SessionOverridePatch,
  type SessionOverrides
} from '@shared/session-overrides'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type Props = {
  config: AgentConfig
  overrides: SessionOverrides
  /** The mode the live session reports, or null before init. */
  sessionPermissionMode: string | null
  onChange: (patch: SessionOverridePatch) => void
}

/**
 * Model, effort and permission mode for the running session.
 *
 * These are the three settings that change mid-conversation, and answering
 * "plan this one out first" used to mean opening the editor and restarting
 * the session — losing the conversation's context to change how it was going
 * to be continued.
 *
 * Every group leads with "Agent default", which clears the override rather
 * than setting the config's current value. The distinction matters: an agent
 * edited later should follow its new config, not a copy of the old one taken
 * when someone opened this menu.
 */
export function SessionControls({
  config,
  overrides,
  sessionPermissionMode,
  onChange
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)

  const active = effectiveSettings(config, overrides)
  const modeNotice = permissionModeNotice(active.permissionMode, sessionPermissionMode)
  const changed = overriddenFields(config, overrides)

  const modelLabel = MODELS.find((m) => m.id === active.model)?.label ?? active.model

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Session settings"
        className="gap-1.5 font-normal"
      >
        <SlidersHorizontal className="size-3.5 opacity-60" />
        <span className="truncate">{modelLabel}</span>
        {changed.length > 0 && (
          // The one signal that this session is not what the agent is
          // configured to be. Without it an override set an hour ago is
          // invisible, and the agent looks like it has changed behaviour.
          <span
            aria-label={`${changed.length} setting${changed.length > 1 ? 's' : ''} changed for this session`}
            className="size-1.5 shrink-0 rounded-full bg-amber-500"
          />
        )}
        <ChevronDown className="size-3.5 shrink-0 opacity-60" />
      </Button>

      {open && (
        <>
          {/* Click-away layer, so the menu closes without a focus trap. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

          <div className="absolute top-full right-0 z-50 mt-1 flex w-80 flex-col overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
            <div className="border-b border-border px-3 py-2.5">
              <p className="text-sm font-medium">This conversation</p>
              <p className="text-xs text-muted-foreground">
                Applies until you change it back or stop the agent. The agent&apos;s saved settings
                are not touched.
              </p>
            </div>

            <div className="flex flex-col gap-3 px-3 py-3">
              <Group
                label="Model"
                options={MODELS.map((m) => ({ id: m.id, label: m.label }))}
                fallback={MODELS.find((m) => m.id === config.model)?.label ?? config.model}
                selected={overrides.model}
                onPick={(model) => onChange({ model })}
              />

              <Group
                label="Effort"
                options={EFFORT_LEVELS.map((id) => ({ id, label: id }))}
                fallback={config.effort ?? 'model default'}
                selected={overrides.effort}
                onPick={(effort) => onChange({ effort })}
              />

              <Group
                label="Permissions"
                options={SESSION_PERMISSION_MODES.map((m) => ({
                  id: m.id,
                  label: m.label,
                  hint: m.hint
                }))}
                fallback={
                  SESSION_PERMISSION_MODES.find((m) => m.id === config.permissionMode)?.label ??
                  config.permissionMode
                }
                selected={overrides.permissionMode}
                onPick={(permissionMode) => onChange({ permissionMode })}
              />
              {modeNotice && (
                <p className="px-3 pb-2 text-xs text-amber-500" role="status">
                  {modeNotice}
                </p>
              )}
            </div>

            {changed.length > 0 && (
              <button
                type="button"
                onClick={() => onChange({ model: null, effort: null, permissionMode: null })}
                className="flex items-center gap-2 border-t border-border px-3 py-2.5 text-left text-sm hover:bg-muted"
              >
                <RotateCcw className="size-3.5 shrink-0 text-muted-foreground" />
                Back to the agent&apos;s settings
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

type Option = { id: string; label: string; hint?: string }

function Group<T extends string>({
  label,
  options,
  fallback,
  selected,
  onPick
}: {
  label: string
  options: Option[]
  /** What the agent's own config resolves to, shown against "Agent default". */
  fallback: string
  selected: T | undefined
  onPick: (value: T | null) => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1">
        <Pill active={selected === undefined} onClick={() => onPick(null)} title={fallback}>
          Agent default
        </Pill>
        {options.map((option) => (
          <Pill
            key={option.id}
            active={selected === option.id}
            title={option.hint}
            onClick={() => onPick(option.id as T)}
          >
            {option.label}
          </Pill>
        ))}
      </div>
    </div>
  )
}

function Pill({
  active,
  title,
  onClick,
  children
}: {
  active: boolean
  title?: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-md border px-2 py-1 text-xs capitalize transition-colors',
        active
          ? 'border-primary/40 bg-primary/15 text-foreground'
          : 'border-transparent bg-muted/50 text-muted-foreground hover:bg-muted'
      )}
    >
      {children}
    </button>
  )
}
