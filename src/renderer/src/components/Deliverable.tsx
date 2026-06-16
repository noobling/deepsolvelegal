import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { FileText, Loader2 } from 'lucide-react'

const hasRedlines = (text: string): boolean => /<(ins|del)>/i.test(text)

export default function Deliverable({
  text,
  running,
  emptyHint
}: {
  text: string
  running: boolean
  emptyHint: string
}): JSX.Element {
  if (!text && running) {
    return (
      <div className="h-full grid place-items-center text-ink-600">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-6 h-6 text-accent animate-spin" />
          <span className="text-sm">{emptyHint}</span>
        </div>
      </div>
    )
  }
  if (!text) {
    return (
      <div className="h-full grid place-items-center text-ink-600">
        <div className="flex flex-col items-center gap-2">
          <FileText className="w-7 h-7 opacity-40" />
          <span className="text-sm">The draft will appear here.</span>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto bg-paper">
      <div className="max-w-3xl mx-auto px-12 py-10">
        {hasRedlines(text) && <RedlineLegend />}
        <div className={`prose-legal ${running ? 'caret' : ''}`}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw]}
            components={{
              a: ({ href, children }) => (
                <a
                  href={href}
                  onClick={(e) => {
                    e.preventDefault()
                    if (href) window.open(href, '_blank')
                  }}
                  style={{ color: '#a07f2e', textDecoration: 'underline' }}
                >
                  {children}
                </a>
              ),
              ins: ({ children }) => (
                <ins style={{ color: '#1a7f37', textDecoration: 'underline', textDecorationColor: '#1a7f37' }}>
                  {children}
                </ins>
              ),
              del: ({ children }) => (
                <del style={{ color: '#b91c1c', textDecorationColor: '#b91c1c' }}>{children}</del>
              )
            }}
          >
            {text}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  )
}

/** Legend shown above any deliverable that contains tracked-change markup. */
function RedlineLegend(): JSX.Element {
  return (
    <div className="mb-6 flex items-center gap-4 text-[12px] text-ink-600 border-b border-black/10 pb-3">
      <span className="font-medium text-ink-700">Redline</span>
      <span style={{ color: '#1a7f37', textDecoration: 'underline' }}>inserted</span>
      <span style={{ color: '#b91c1c', textDecoration: 'line-through' }}>deleted</span>
      <span className="ml-auto text-ink-500">Export to Word to keep the markup.</span>
    </div>
  )
}
