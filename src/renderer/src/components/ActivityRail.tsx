import { useEffect, useRef, useState } from 'react'
import { useStore, deriveDocAndChat } from '../state/store'
import ToolChip from './ToolChip'
import PromptCost from './PromptCost'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Send, Square, Sparkles } from 'lucide-react'

export default function ActivityRail(): JSX.Element {
  const { messages, documentText, activities, running, sendFollow, cancelRun } = useStore()
  const [text, setText] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  // The chat panel shows the conversation (review, questions, replies); the
  // document itself lives in the main pane (see deriveDocAndChat).
  const { chat } = deriveDocAndChat(messages, documentText)
  const timeline = [
    ...chat.map((m) => ({ kind: 'msg' as const, t: m.createdAt, m })),
    ...activities.map((a) => ({ kind: 'tool' as const, t: a.startedAt, a }))
  ].sort((x, y) => x.t - y.t)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [timeline.length, running])

  const submit = (): void => {
    if (!text.trim() || running) return
    void sendFollow(text.trim())
    setText('')
  }

  return (
    <aside className="w-[360px] shrink-0 border-l border-ink-700/60 bg-ink-900/40 flex flex-col">
      <div className="px-4 py-3 border-b border-ink-700/60 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-accent" />
        <span className="text-sm font-medium text-slate-200">Activity</span>
        {running && <span className="ml-auto text-[11px] text-accent animate-pulse">working…</span>}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {timeline.length === 0 && !running && (
          <div className="text-[12.5px] text-ink-600 px-1 py-2">
            Tool activity and your follow-up messages will appear here.
          </div>
        )}
        {timeline.map((item) =>
          item.kind === 'tool' ? (
            <ToolChip key={item.a.id} activity={item.a} />
          ) : item.m.role === 'user' ? (
            <div key={item.m.id} className="ml-6 rounded-lg bg-accent/10 border border-accent/20 px-3 py-2 text-[12.5px] text-slate-200">
              {item.m.text}
            </div>
          ) : (
            <div
              key={item.m.id}
              className="mr-6 rounded-lg bg-ink-800/60 border border-ink-700/70 px-3 py-2 text-[12.5px] text-slate-300 prose-chat"
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.m.text || '…'}</ReactMarkdown>
            </div>
          )
        )}
      </div>

      <div className="p-3 border-t border-ink-700/60">
        <div className="flex items-end gap-2">
          <textarea
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            placeholder="Ask for a revision…  e.g. “make clause 7 mutual”"
            className="flex-1 bg-ink-950 border border-ink-700 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-accent/60 resize-none"
          />
          {running ? (
            <button
              onClick={() => void cancelRun()}
              className="h-9 w-9 grid place-items-center rounded-lg bg-red-500/15 text-red-400 hover:bg-red-500/25"
              title="Stop"
            >
              <Square className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={submit}
              className="h-9 w-9 grid place-items-center rounded-lg bg-accent text-ink-950 hover:bg-accent-soft"
              title="Send"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </div>
        <PromptCost text={text} />
      </div>
    </aside>
  )
}
