import { useEffect } from 'react'
import { X } from '@phosphor-icons/react'

export function PageHeader({ eyebrow, title, description, actions }) {
  return (
    <div className="page-header">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  )
}

export function Badge({ children, tone = 'neutral' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

export function StatCard({ icon: Icon, label, value, detail, tone = 'teal' }) {
  return (
    <article className="stat-card">
      <div className={`stat-icon stat-icon-${tone}`}><Icon size={21} weight="duotone" /></div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {detail && <small>{detail}</small>}
      </div>
    </article>
  )
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="empty-state">
      {Icon && <Icon size={34} weight="duotone" />}
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  )
}

export function Modal({ title, description, children, onClose, wide = false }) {
  useEffect(() => {
    document.body.classList.add('overlay-open')
    return () => document.body.classList.remove('overlay-open')
  }, [])

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className={`modal ${wide ? 'modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div><h2>{title}</h2>{description && <p>{description}</p>}</div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X size={20} weight="bold" /></button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  )
}

export function Field({ label, required, hint, children, span = false }) {
  return (
    <label className={`field ${span ? 'field-span' : ''}`}>
      <span>{label}{required && <b aria-hidden="true"> *</b>}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  )
}

export function SectionCard({ title, description, action, children, className = '' }) {
  return (
    <section className={`section-card ${className}`}>
      {(title || action) && (
        <header className="section-header">
          <div>{title && <h2>{title}</h2>}{description && <p>{description}</p>}</div>
          {action}
        </header>
      )}
      {children}
    </section>
  )
}
