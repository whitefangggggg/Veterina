import { ChatText, EnvelopeSimple, Phone } from '@phosphor-icons/react'

export default function ContactActions({ contact }) {
  const phone = (contact?.normalizedPhone || contact?.phone || '').replace(/[^+\d]/g, '')
  const name = contact?.fullName || contact?.name || 'contact'
  return <span className="contact-actions">
    {phone && <><a className="action-pill" href={`tel:${phone}`} aria-label={`Call ${name}`}><Phone size={14} weight="bold" /> Call</a><a className="action-pill" href={`sms:${phone}`} aria-label={`Text ${name}`}><ChatText size={14} weight="bold" /> SMS</a></>}
    {contact?.email && <a className="action-pill" href={`mailto:${contact.email}`} aria-label={`Email ${name}`}><EnvelopeSimple size={14} /> Email</a>}
  </span>
}
