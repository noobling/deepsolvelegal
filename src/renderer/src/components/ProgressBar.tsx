/** The slim progress bar shared by the document-set card and the set-detail view. */
export default function ProgressBar({ pct, className = '' }: { pct: number; className?: string }): JSX.Element {
  return (
    <div className={`h-1.5 rounded-full bg-ink-800 overflow-hidden ${className}`}>
      <div className="h-full bg-accent transition-all" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  )
}
