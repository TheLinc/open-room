import { memo } from 'react'
import { Brain, ChevronRight, CircleAlert, Layers, Terminal, Wrench } from 'lucide-react'
import type { TranscriptEntry } from '@shared/agent-runtime'
import { cn } from '@/lib/utils'
import { isCommandEcho } from '@/lib/transcript'
import { isSyntheticAssistant, parseCommand } from '@shared/slash-commands'
import { isInjectedSummary } from '@shared/compaction'
import { MarkdownText } from './markdown'

/** The half of `SDKCompactBoundaryMessage.compact_metadata` worth showing. */
type CompactMetadata = {
  trigger?: 'manual' | 'auto'
  pre_tokens?: number
  post_tokens?: number
}

/** Compaction figures are six digits; "152K" reads at a glance and "152,431" does not. */
function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}K` : String(tokens)
}

/**
 * Renders one SDK message.
 *
 * The rule from CLAUDE.md is absolute: content is shown as it arrived. Text is
 * never rewritten, summarised, or truncated, and tool inputs are shown as the
 * model wrote them. Anything this component does not recognise falls back to
 * pretty-printed JSON rather than being dropped — showing an unfamiliar
 * message honestly beats hiding it.
 */

type ContentBlock = {
  type: string
  text?: string
  thinking?: string
  name?: string
  input?: unknown
  content?: unknown
  is_error?: boolean
  tool_use_id?: string
}

type SdkMessage = {
  type: string
  subtype?: string
  message?: { role?: string; content?: ContentBlock[] | string }
  result?: string
  is_error?: boolean
  total_cost_usd?: number
  num_turns?: number
  error?: string
}

function Json({ value }: { value: unknown }): React.JSX.Element {
  return (
    <pre className="overflow-x-auto rounded bg-muted/40 p-2 font-mono text-[11px] whitespace-pre-wrap">
      {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
    </pre>
  )
}

function Block({
  block,
  markdown = false
}: {
  block: ContentBlock
  markdown?: boolean
}): React.JSX.Element | null {
  switch (block.type) {
    case 'text':
      return markdown ? (
        <MarkdownText text={block.text ?? ''} />
      ) : (
        <p className="text-sm whitespace-pre-wrap">{block.text}</p>
      )

    case 'thinking':
      return (
        <details className="rounded border border-border/60 bg-muted/20 px-2 py-1.5">
          <summary className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground select-none">
            <Brain className="size-3.5" /> Thinking
          </summary>
          <p className="mt-2 text-xs whitespace-pre-wrap text-muted-foreground">{block.thinking}</p>
        </details>
      )

    case 'tool_use':
      return (
        <details className="rounded border border-border/60 bg-muted/20 px-2 py-1.5">
          <summary className="flex cursor-pointer items-center gap-1.5 text-xs select-none">
            <Wrench className="size-3.5 text-muted-foreground" />
            <span className="font-mono">{block.name}</span>
          </summary>
          <div className="mt-2">
            <Json value={block.input} />
          </div>
        </details>
      )

    case 'tool_result':
      return (
        <details
          className={cn(
            'rounded border px-2 py-1.5',
            block.is_error
              ? 'border-destructive/40 bg-destructive/5'
              : 'border-border/60 bg-muted/20'
          )}
        >
          <summary className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground select-none">
            <ChevronRight className="size-3.5" />
            {block.is_error ? 'Tool error' : 'Tool result'}
          </summary>
          <div className="mt-2">
            <Json value={block.content} />
          </div>
        </details>
      )

    default:
      return (
        <details className="rounded border border-border/60 bg-muted/20 px-2 py-1.5">
          <summary className="cursor-pointer font-mono text-xs text-muted-foreground select-none">
            {block.type}
          </summary>
          <div className="mt-2">
            <Json value={block} />
          </div>
        </details>
      )
  }
}

function blocksOf(message: SdkMessage): ContentBlock[] {
  const content = message.message?.content
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return Array.isArray(content) ? content : []
}

export const TranscriptMessage = memo(function TranscriptMessage({
  entry
}: {
  entry: TranscriptEntry
}): React.JSX.Element | null {
  const message = entry.message as SdkMessage

  // Kept in step with `isRenderable`, which is what actually keeps this out
  // of the list. Changing the model makes the CLI echo the change back as
  // user content — live, and again from persisted history on resume — which
  // would otherwise appear as an XML fragment nobody typed.
  if (message.type === 'user' && isCommandEcho(entry)) return null

  if (message.type === 'assistant' && isSyntheticAssistant(message)) {
    // Output of a slash command the CLI ran locally. Rendered apart from the
    // model's replies so the transcript stays a record of who said what —
    // the /context table is not the agent talking.
    return (
      <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Terminal className="size-3.5" /> Command output
        </span>
        {blocksOf(message).map((block, i) => (
          <Block key={i} block={block} />
        ))}
      </div>
    )
  }

  if (message.type === 'assistant') {
    return (
      <div className="flex flex-col gap-2">
        {message.error && (
          <p className="flex items-center gap-1.5 text-sm text-destructive">
            <CircleAlert className="size-3.5" /> {message.error}
          </p>
        )}
        {blocksOf(message).map((block, i) => (
          <Block key={i} block={block} markdown />
        ))}
      </div>
    )
  }

  if (message.type === 'user' && isInjectedSummary(message)) {
    // The compaction summary, which the CLI injects as a user message. It is
    // what the agent now remembers, so it is worth reading — but not as
    // something the user said.
    return (
      <details className="rounded border border-border/60 bg-muted/20 px-2 py-1.5">
        <summary className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground select-none">
          <Layers className="size-3.5" /> Context summary after compaction
        </summary>
        <div className="mt-2 flex flex-col gap-2 text-muted-foreground">
          {blocksOf(message).map((block, i) => (
            <Block key={i} block={block} />
          ))}
        </div>
      </details>
    )
  }

  if (message.type === 'user') {
    const blocks = blocksOf(message)
    // Tool results come back as user-role messages; showing them under a
    // "you said" heading would misattribute them.
    const isToolResult = blocks.every((b) => b.type === 'tool_result')

    if (isToolResult) {
      return (
        <div className="flex flex-col gap-2">
          {blocks.map((block, i) => (
            <Block key={i} block={block} />
          ))}
        </div>
      )
    }

    const text = blocks.map((b) => b.text).join('\n')
    const command = parseCommand(text)

    // A command is not a prompt. Same side of the pane, different shape, so
    // "/compact" never reads as something the user asked in prose.
    if (command) {
      return (
        <div className="flex justify-end">
          <div className="flex max-w-[85%] items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 font-mono text-xs">
            <Terminal className="size-3.5 shrink-0 text-muted-foreground" />
            <span>/{command.name}</span>
            {command.args && <span className="text-muted-foreground">{command.args}</span>}
          </div>
        </div>
      )
    }

    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap">
          {text}
        </div>
      </div>
    )
  }

  if (message.type === 'result') {
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs',
          message.is_error
            ? 'border-destructive/40 bg-destructive/5 text-destructive'
            : 'border-border/60 text-muted-foreground'
        )}
      >
        <Terminal className="size-3.5 shrink-0" />
        <span>
          {message.is_error ? `Ended: ${message.subtype}` : 'Turn complete'}
          {typeof message.num_turns === 'number' && ` · ${message.num_turns} turns`}
          {typeof message.total_cost_usd === 'number' && ` · $${message.total_cost_usd.toFixed(4)}`}
        </span>
      </div>
    )
  }

  // system/init and the long tail of status messages carry no user-facing
  // content worth a row of their own. Kept in step with `isRenderable`, which
  // is what actually keeps them out of the list — returning null here still
  // leaves a sized placeholder behind.
  if (message.type === 'system' && message.subtype === 'compact_boundary') {
    const meta = (message as { compact_metadata?: CompactMetadata }).compact_metadata
    const before = meta?.pre_tokens
    const after = meta?.post_tokens
    const shrunk =
      typeof before === 'number' && typeof after === 'number'
        ? `${formatTokens(before)} → ${formatTokens(after)}`
        : typeof before === 'number'
          ? `was ${formatTokens(before)}`
          : null

    return (
      <div className="flex items-center gap-3 py-1 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        <span className="flex shrink-0 items-center gap-1.5">
          <Layers className="size-3.5" />
          {meta?.trigger === 'manual' ? 'Compacted' : 'Context compacted automatically'}
          {shrunk ? ` · ${shrunk}` : ''}
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>
    )
  }

  if (
    message.type === 'system' ||
    message.type === 'stream_event' ||
    message.type === 'rate_limit_event'
  ) {
    return null
  }

  return (
    <details className="rounded border border-border/60 bg-muted/20 px-2 py-1.5">
      <summary className="cursor-pointer font-mono text-xs text-muted-foreground select-none">
        {message.type}
        {message.subtype ? ` · ${message.subtype}` : ''}
      </summary>
      <div className="mt-2">
        <Json value={message} />
      </div>
    </details>
  )
})
