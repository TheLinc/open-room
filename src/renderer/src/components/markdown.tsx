import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

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
    <div className="markdown text-sm">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          // `setWindowOpenHandler` in main routes `_blank` to the OS browser;
          // a plain click would navigate the renderer itself away.
          a: ({ node, ...props }) => {
            // `node` is the hast element; it must not reach the DOM as an attribute.
            void node
            return <a {...props} target="_blank" rel="noreferrer" />
          }
        }}
      >
        {text}
      </Markdown>
    </div>
  )
}
