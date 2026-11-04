import { useEffect, useState } from 'react'
import { Copy, QrCode } from '@phosphor-icons/react'
import { supabase } from '../lib/supabaseClient'
import { clinicRegistrationUrl } from '../lib/clinicAccess'
import { SectionCard } from './ui'
import { RecordEditor } from './RecordForm'

export default function ClinicJoinCode() {
  const [code, setCode] = useState('')
  const [qr, setQr] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [rotating, setRotating] = useState(false)
  const load = async (rotate = false) => {
    const { data, error } = await supabase.rpc('owner_veterina_code', { p_rotate: rotate })
    if (error || !data?.code) throw new Error('The Veterina Code could not be loaded. Please try again.')
    if (data.code !== code) setQr('')
    setCode(data.code); setCopied(false); setError('')
  }
  useEffect(() => {
    let alive = true
    void supabase.rpc('owner_veterina_code', { p_rotate: false }).then(({ data, error }) => {
      if (alive) { if (error || !data?.code) setError('The Veterina Code could not be loaded.'); else setCode(data.code) }
    }).catch(() => { if (alive) setError('The Veterina Code could not be loaded. Please try again.') })
    return () => { alive = false }
  }, [])
  useEffect(() => {
    let alive = true
    if (code) void import('qrcode').then(({ default: QRCode }) => QRCode.toDataURL(clinicRegistrationUrl(code, window.location.origin), { width: 240, margin: 2, errorCorrectionLevel: 'M' }))
      .then((data) => { if (alive) setQr(data) }).catch(() => { if (alive) setError('The QR could not be generated. You can still share the code.') })
    return () => { alive = false }
  }, [code])
  return <SectionCard title="Your Veterina Code" className="clinic-code-card" description="Invite staff to register for your shop, then approve their access.">
    <div className="clinic-code-content"><div>
      <span className="eyebrow">Staff registration</span>
      {code ? <code className="clinic-registration-code">{code}</code> : <p role="status">{error ? 'Code unavailable' : 'Loading your code…'}</p>}
      <p>Share this code or QR with your staff. Registration requires email confirmation and your approval before they can access clinic records.</p>
      <div className="record-actions"><button className="button button-secondary small-button" disabled={!code} onClick={async () => {
        try { await navigator.clipboard.writeText(code); setCopied(true) } catch { setError('Copy is unavailable. Select and copy the displayed code instead.') }
      }}><Copy size={16} />{copied ? 'Copied' : 'Copy code'}</button>
        <button className="text-link" disabled={!code} onClick={() => setRotating(true)}>Generate new code</button></div>
      {copied && <span role="status" className="auth-hint">Veterina Code copied.</span>}
      {error && <p className="auth-message auth-error" role="alert">{error}<button className="text-link" onClick={() => load().catch((failure) => setError(failure.message))}>Retry</button></p>}
    </div><div className="clinic-code-qr">{qr ? <><img src={qr} width="220" height="220" alt="Scan to register as staff with this shop's Veterina Code prefilled" /><a className="text-link" href={qr} download="veterina-staff-registration-qr.png">Download registration QR</a></> : <QrCode size={64} aria-hidden="true" />}</div></div>
    {rotating && <RecordEditor title="Generate a new Veterina Code?" description="Previous codes and QR links will stop accepting new registrations. Existing staff and pending approval requests stay linked to this shop."
      fields={[]} submitLabel="Generate new code" onSave={() => load(true)} onClose={() => setRotating(false)} />}
  </SectionCard>
}
