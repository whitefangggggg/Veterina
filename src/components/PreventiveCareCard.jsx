import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { Badge } from './ui'
import { preventiveLabel } from '../lib/preventiveCare'
import './PreventiveCare.css'

export default function PreventiveCareCard({ record, onEdit, onDelete }) {
  const historical = record.recordingPurpose === 'record_only'
  const date = record.administeredAt ? parseISO(record.administeredAt) : null
  return <article className="visit-card section-card preventive-history-card preventive-care-card" id={`preventive-${record.id}`}>
    <div className="visit-date">{date && !Number.isNaN(date.getTime()) ? <><span>{format(date, 'MMM')}</span><strong>{format(date, 'dd')}</strong><small>{format(date, 'yyyy')}</small></> : <small>Not recorded</small>}</div>
    <div className="visit-content">
    <header><div><Badge>{preventiveLabel(record.kind)}</Badge><h3>{record.kind === 'vaccination' ? `${record.items.length} vaccine${record.items.length === 1 ? '' : 's'}` : record.items[0]?.vaccine}</h3><p>{record.administeredAt} · {record.veterinarianName || 'Veterinarian not recorded'}</p></div><Badge>{historical ? 'Record only' : record.careStatus}</Badge></header>
    <ol className="preventive-history-items">{record.items.map((item) => <li key={item.id} id={`vaccination-${item.id}`}>
      <strong>{item.vaccine}</strong><dl><div><dt>Brand / batch</dt><dd>{item.brand || 'Not recorded'} · {item.lotNumber || 'Lot not recorded'}</dd></div><div><dt>Dose</dt><dd>{item.dose || 'Not recorded'}</dd></div><div><dt>{historical ? 'Historical next due' : 'Next due'}</dt><dd>{item.nextDueAt || 'Not scheduled'}</dd></div></dl>
      {!historical && <Badge tone={item.nextDoseStatus === 'Overdue' ? 'danger' : item.nextDoseStatus === 'Due today' ? 'warning' : 'neutral'}>{item.nextDoseStatus || record.nextDoseStatus}</Badge>}
      {item.consumed && <p className="muted">Deducted {item.dispenseQuantity} {item.dispenseUnit || 'units'} from inventory.</p>}
    </li>)}</ol>
    <div className="record-actions">{['Waiting', 'In progress'].includes(record.careStatus) ? <Link className="button button-secondary small-button" to="/queue">Open queued care</Link> : onEdit && <button className="button button-secondary small-button" onClick={() => onEdit(record)}>Edit {record.kind === 'deworming' ? 'deworming' : 'vaccination record'}</button>}
      {onDelete && <button className="button button-secondary small-button danger-text" disabled={record.items.some((item) => item.consumed)} title={record.items.some((item) => item.consumed) ? 'Stock history must be retained. Use Inventory for stock corrections.' : undefined} onClick={() => onDelete(record)}>Delete record</button>}
    </div>
    </div>
  </article>
}
