import { cloneElement, isValidElement, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { EmptyState, Modal } from './ui'
import CalendarRecordEditor from './CalendarRecordEditor'

export default function CalendarDayPreview({ label, day, count, itemName, itemPlural, timezone, onClose, children }) {
  const [editAction, setEditAction] = useState(null)
  if (editAction) return <CalendarRecordEditor action={editAction} onClose={() => setEditAction(null)} />
  return <Modal wide title={`${label} · ${format(parseISO(day), 'd MMMM yyyy')}`}
    description={`${count} matching ${count === 1 ? itemName : itemPlural} · ${timezone}`} onClose={onClose}>
    <div className="calendar-day-preview">
      {count ? isValidElement(children) ? cloneElement(children, { onEdit: setEditAction }) : children : <EmptyState title={`No ${itemPlural} on this day`} description="Close this preview and choose another date or adjust your filters." />}
    </div>
  </Modal>
}
