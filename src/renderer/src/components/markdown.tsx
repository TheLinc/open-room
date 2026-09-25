import { useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Copy } from 'lucide-react'

/**
 * Renders the model's prose as markdown.
 *
 * Consistent with "chat output is never altered": that rule is about content,
 * and terminal Claude Code renders markdown too. The text arrives as written
 * — nothing is rewritten before it gets here — this only decides how the
 * marks the model chose are drawn. Only assistant text goes through this;
 * what the user typed and what a slash command printed are shown verbatim.
 *
 * Element styling lives under `.markdown` in `main.css`, since Tailwind's
 * preflight strips every default and the typography plugin is not installed.
 */
export function MarkdownText({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="markdown text-sm wrap-anywhere">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          // `setWindowOpenHandler` in main routes `_blank` to the OS browser;
          // a plain click would navigate the renderer itself away.
          a: ({ node, ...props }) => {
            // `node` is the hast element; it must not reach the DOM as an attribute.
            void node
            return <a {...props} target="_blank" rel="noreferrer" />
          },
          pre: ({ node, ...props }) => {
            void node
            return <CodeBlock {...props} />
          }
        }}
      >
        {text}
      </Markdown>
    </div>
  )
}

/** A fenced block with a copy button in its corner, shown on hover or focus. */
function CodeBlock(props: React.ComponentProps<'pre'>): React.JSX.Element {
  const ref = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)

  const copy = (): void => {
    window.openRoom.copyText(ref.current?.textContent ?? '')
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="group relative">
      <pre ref={ref} {...props} />
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'Copied' : 'Copy code'}
        title={copied ? 'Copied' : 'Copy code'}
        className="absolute top-1 right-1 rounded border border-code-border bg-code p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  )
}
