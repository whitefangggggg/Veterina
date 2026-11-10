import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { clinicErrorMessage, createMutationRunner, unwrap } from '../lib/clinicRepository'
import { admissionTrackingQr, sharingState, trackingTime } from '../lib/admissionTracking'
import { escapeHtml } from '../lib/prescriptions'
import { Badge, Field, SectionCard } from './ui'
import VeterinaCheckbox from './VeterinaCheckbox'
import MutationForm from './MutationForm'
import './AdmissionSharing.css'

const columns = 'id,enabled,token_hash,expires_at,pet_display_name,clinic_name,clinic_contact,show_species,show_admission_details,public_reason,published_update,published_at,updated_at,version,share_clinical_details'
const readSharing = async id => unwrap(await supabase.from('admission_public_sharing').select(columns).eq('id', id).maybeSingle())

export default function AdmissionSharing({ admission, clinic }) {
  const [sharing, setSharing] = useState(undefined)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [credential, setCredential] = useState(null)
  const [qr, setQr] = useState(null)
  const [printing, setPrinting] = useState(false)
  const fields = useRef(null)
  const update = useRef(null)
  const mutate = useMemo(() => createMutationRunner(supabase), [])
  const load = useCallback(async () => {
    try { setSharing(await readSharing(admission.id)); setError(''); return true }
    catch (e) { setError(clinicErrorMessage(e)); return false }
  }, [admission.id])
  useEffect(() => {
    let active = true
    readSharing(admission.id).then(row => { if (active) setSharing(row) }).catch(e => { if (active) setError(clinicErrorMessage(e)) })
    return () => { active = false }
  }, [admission.id])
  useEffect(() => {
    let active = true
    setQr(null)
    if (credential?.token) admissionTrackingQr(credential.token).then(value => { if (active) setQr(value) }).catch(() => { if (active) setError('The QR card could not be prepared. Reopen public tracking or generate a new code.') })
    return () => { active = false }
  }, [credential])
  const save = async (action, payload) => {
    const result = await mutate(action, { id: admission.id, expectedVersion: sharing?.version || 0, ...payload })
    if (result.token) {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(result.token))
      setCredential({ token: result.token, hash: [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('') })
    }
    if (action === 'tracking_revoke') setCredential(null)
    const refreshed = await load()
    setNotice(refreshed ? 'Public sharing saved.' : 'Saved. Retry refresh before making another change.')
  }
  const state = sharingState(sharing, admission)
  const usable = credential && sharing?.token_hash === credential.hash && state === 'Enabled'
  const print = async () => {
    setPrinting(true); setError('')
    try {
      const current = await readSharing(admission.id)
      setSharing(current)
      if (!current || current.token_hash !== credential.hash || sharingState(current, admission) !== 'Enabled') throw new Error('This tracking card is no longer active. Generate a new code.')
      const frame = document.createElement('iframe')
      frame.title = 'Print admission tracking card'
      frame.style.cssText = 'position:fixed;width:1px;height:1px;border:0;opacity:0'
      frame.srcdoc = `<!doctype html><html><head><title>Admission tracking card</title><meta name="referrer" content="no-referrer"><style>body{font:17px Arial;color:#173f37;padding:32px;text-align:center;overflow-wrap:anywhere}img{width:240px;height:240px}strong{display:block;font:28px monospace;letter-spacing:3px}small{display:block;margin:20px auto;max-width:420px;line-height:1.5}</style></head><body><h1>${escapeHtml(current.clinic_name)}</h1><h2>${escapeHtml(current.pet_display_name)} · Track admission</h2><img src="${qr.image}" alt="Admission tracking QR code"><strong>${escapeHtml(credential.token)}</strong><p>${escapeHtml(qr.url)}</p><p>${escapeHtml(current.clinic_contact)}</p><small>Keep this card private. Anyone with the code can view clinic-shared updates. Valid until ${escapeHtml(trackingTime(current.expires_at, clinic.timezone))}, or 7 days after discharge, whichever comes first. Replaced or revoked codes stop working immediately.</small></body></html>`
      await new Promise((resolve, reject) => {
        frame.onload = async () => {
          try {
            await Promise.all([...frame.contentDocument.images].map(img => img.decode()))
            frame.contentWindow.addEventListener('afterprint', () => frame.remove(), { once: true })
            frame.contentWindow.focus(); frame.contentWindow.print(); setTimeout(() => frame.remove(), 60000); resolve()
          } catch (e) { frame.remove(); reject(e) }
        }
        document.body.appendChild(frame)
      })
    } catch (e) { setError(e.message || 'Could not print the tracking card.') }
    finally { setPrinting(false) }
  }
  if (sharing === undefined) return <SectionCard title="Public tracking"><p role={error ? 'alert' : 'status'}>{error || 'Loading sharing controls…'}</p>{error && <button className="button button-secondary" onClick={load}>Retry refresh</button>}</SectionCard>
  if (admission.is_historical || admission.status === 'cancelled') return <SectionCard title="Public tracking"><p>Public tracking is unavailable for cancelled and historical admissions. Existing codes for cancelled admissions stop working immediately.</p></SectionCard>
  const defaults = sharing || {
    pet_display_name: admission.patientName || clinic.pets.find(p => p.id === admission.pet_id)?.name || '',
    clinic_name: clinic.settings?.clinic_name || '',
    clinic_contact: [clinic.settings?.phone, clinic.settings?.email, clinic.settings?.address].filter(Boolean).join('\n'),
  }
  return <SectionCard title="Public tracking" description="Approve what the pet owner can see, then explicitly enable sharing. Every saved change is audited.">
    <div className="admission-sharing">
      <p><Badge tone={state === 'Enabled' ? 'success' : 'neutral'}>{state}</Badge>{sharing?.expires_at && <> Code expiry: {trackingTime(sharing.expires_at, clinic.timezone)}</>}</p>
      <p className="admission-sharing-guidance">Anyone with the code or QR link can view the approved information. It does not verify owner identity. Share through a clinic-approved channel. Clinical details stay private unless you enable live clinical sharing below. Structured owner contact information, inventory records and discharge-summary documents are excluded.</p>
      <p>Codes last up to 90 days and expire 7 days after discharge, whichever comes first. Cancelled admissions and inactive clinics or subscriptions are unavailable. New codes replace all prior links.</p>
      {notice && <p role="status">{notice}</p>}
      <button className="text-link" onClick={load}>Refresh sharing controls</button>
      {error && <p role="alert">{error} <button className="text-link" onClick={load}>Retry refresh</button></p>}
      <MutationForm key={`fields-${sharing?.version || 0}`} onSubmit={async () => {
        const form = new FormData(fields.current.closest('form'))
        await save('tracking_configure', { petDisplayName: form.get('petName'), clinicName: form.get('clinicName'), clinicContact: form.get('contact'), publicReason: form.get('reason'), showSpecies: form.has('species'), showAdmissionDetails: form.has('details') })
      }}>
        <div ref={fields} className="admission-sharing-fields">
          <h3>Approved public fields</h3>
          <Field label="Public pet name" required><input name="petName" required maxLength={120} defaultValue={defaults.pet_display_name} /></Field>
          <Field label="Public clinic name" required><input name="clinicName" required maxLength={200} defaultValue={defaults.clinic_name} /></Field>
          <Field label="Approved clinic contact" hint="Only enter clinic details you approve for public display."><textarea name="contact" maxLength={1000} rows={3} defaultValue={defaults.clinic_contact} /></Field>
          <VeterinaCheckbox name="species" label="Publish pet species" defaultChecked={!!defaults.show_species} />
          <VeterinaCheckbox name="details" label="Publish admission reference and date" defaultChecked={!!defaults.show_admission_details} />
          <Field label="Approved public reason (optional)" hint="Write a separate summary reason. Enabling live clinical sharing also exposes clinical notes as recorded."><textarea name="reason" maxLength={1000} defaultValue={defaults.public_reason || ''} /></Field>
          <button className="button button-secondary">Approve public fields</button>
        </div>
      </MutationForm>
      <div className="admission-sharing-controls">
        <MutationForm key={`generate-${sharing?.version || 0}`} onSubmit={async () => save('tracking_generate', { acknowledgePublic: true })}>
          <VeterinaCheckbox label="I approve public access to these fields and understand that anyone with the code can view them." required />
          <button className="button button-primary" disabled={!sharing?.pet_display_name || !sharing?.clinic_name}>{state === 'Enabled' ? 'Replace tracking code' : 'Enable and generate code'}</button>
        </MutationForm>
        {sharing?.enabled && <MutationForm onSubmit={() => save('tracking_revoke', {})}><button className="button button-secondary">Revoke public tracking</button></MutationForm>}
      </div>
      {usable && <div className="admission-tracking-card"><h3>Owner’s tracking card</h3><strong className="admission-tracking-code">{credential.token}</strong>{qr ? <><img src={qr.image} alt="QR code to view shared admission updates" width="280" height="280" /><Field label="Tracking link"><input readOnly value={qr.url} onFocus={e => e.target.select()} /></Field><div className="admission-actions"><button className="button button-secondary" onClick={async () => { try { await navigator.clipboard.writeText(qr.url); setNotice('Tracking link copied. Share it privately.') } catch { setError('Select and copy the tracking link above.') } }}>Copy tracking link</button><button className="button button-secondary" disabled={printing} onClick={print}>{printing ? 'Preparing…' : 'Print QR card'}</button></div></> : <p role="status">Preparing QR code…</p>}<p>Save or print this code now. Only its hash is stored in the sharing record. Reopening these controls requires generating a replacement code.</p></div>}
      <div className="admission-clinical-sharing">
        <h3>Live clinical sharing</h3>
        <p>Admission activity, Monitoring & notes, and Care board are {sharing?.share_clinical_details ? 'shared live' : 'private'}. Enabling shares all existing and future entries, including clinical condition, notes as written, measurements, medication instructions and doses, and staff names. New entries need no individual publication. Existing codes keep working.</p>
        {sharing?.share_clinical_details
          ? <MutationForm onSubmit={() => save('tracking_clinical_sharing', { enabled: false })}><button className="button button-secondary">Disable clinical sharing</button></MutationForm>
          : <MutationForm key={`clinical-${sharing?.version || 0}`} onSubmit={() => save('tracking_clinical_sharing', { enabled: true, acknowledgePublic: true })}>
            <VeterinaCheckbox label="I approve sharing all existing and future clinical entries, medication doses and staff names with anyone holding the code." required />
            <button className="button button-primary">Enable clinical sharing</button>
          </MutationForm>}
      </div>
      <MutationForm key={`update-${sharing?.version || 0}`} onSubmit={async () => {
        await save('tracking_publish', { update: update.current.value, acknowledgePublic: true })
      }}>
        <h3>Owner-facing update</h3>
        <Field label="Update to publish" hint="Write only information approved for the pet owner. Publishing replaces the latest update."><textarea ref={update} name="update" maxLength={2000} rows={4} required defaultValue={sharing?.published_update || ''} /></Field>
        <VeterinaCheckbox label="I approve this update for anyone holding the tracking code." required />
        <button className="button button-primary">Publish update</button>
      </MutationForm>
      {sharing?.published_update && <div><h3>Currently published</h3><p className="admission-prose">{sharing.published_update}</p><p>{trackingTime(sharing.published_at, clinic.timezone)}</p><MutationForm onSubmit={() => save('tracking_unpublish', {})}><button className="button button-secondary">Unpublish update</button></MutationForm></div>}
    </div>
  </SectionCard>
}
