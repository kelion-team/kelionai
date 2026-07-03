import type { SkillCard } from '../lib/chat'

// Renders a structured skill result (emails, calendar, tasks, Drive, contacts,
// web results) as a clean card on the monitor. One generic list layout for all.
const ICONS: Record<string, string> = {
  emails: '✉',
  calendar: '📅',
  tasks: '✓',
  drive: '📁',
  contacts: '👤',
  search: '🔎',
}

export function CardView({ card }: { card: SkillCard }): React.JSX.Element {
  return (
    <div className="card-view">
      <div className="card-view-head">
        <span className="card-view-icon">{ICONS[card.type] ?? '•'}</span>
        <span>{card.title}</span>
        <span className="card-view-count">{card.items.length}</span>
      </div>
      <div className="card-view-list">
        {card.items.map((it, i) => {
          const body = (
            <>
              <div className="card-item-primary">{it.primary}</div>
              {it.secondary && <div className="card-item-secondary">{it.secondary}</div>}
              {it.meta && <div className="card-item-meta">{it.meta}</div>}
            </>
          )
          return it.url ? (
            <a key={i} className="card-item" href={it.url} target="_blank" rel="noreferrer">
              {body}
            </a>
          ) : (
            <div key={i} className="card-item">
              {body}
            </div>
          )
        })}
      </div>
    </div>
  )
}
