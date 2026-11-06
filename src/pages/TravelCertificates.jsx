import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { FileText, Plus, Printer } from '@phosphor-icons/react'
import { useClinicData } from '../context/ClinicDataContext'
import { useAuth } from '../context/AuthContext'
import { Badge, EmptyState, Field, Modal, PageHeader } from '../components/ui'
import Combobox from '../components/Combobox'
import { clinicErrorMessage, createMutationRunner } from '../lib/clinicRepository'
import { supabase } from '../lib/supabaseClient'
import { CERTIFICATE_PAGE_SIZE, fetchTravelCertificate, fetchTravelCertificates } from '../lib/travelCertificateRepository'
import { completedTravelVaccinations, isPatientPhotoDataUrl, printTravelCertificate, travelCertificateErrors, travelCertificateHtml, travelCertificatePreview } from '../lib/travelCertificates'
import { petPhotoRequest } from '../lib/petPhotos'
import './TravelCertificates.css'

function DocumentPreview({ certificate }) {
  return <iframe className="travel-certificate-preview" title="Travel certificate preview" sandbox="" tabIndex={0} srcDoc={travelCertificateHtml(certificate)} />
}

function IssueCertificate({ initialPetId, mutate, onIssued, onClose }) {
  const data = useClinicData()
  const { user } = useAuth()
  const [petId, setPetId] = useState(initialPetId || '')
  const [issuerId, setIssuerId] = useState(user.id)
  const [travelDate, setTravelDate] = useState('')
  const [destination, setDestination] = useState('')
  const [rabiesId, setRabiesId] = useState('')
  const [rabiesConfirmed, setRabiesConfirmed] = useState(false)
  const [eligibilityConfirmed, setEligibilityConfirmed] = useState(false)
  const [isPublic, setIsPublic] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [photo, setPhoto] = useState(null)
  const [photoRetry, setPhotoRetry] = useState(0)
  const pet = data.pets.find((entry) => entry.id === petId)
  const photoKey = pet?.has_photo ? `${pet.id}:${pet.photo_revision}` : ''
  useEffect(() => {
    if (!photoKey) return
    let active = true
    petPhotoRequest({ action: 'prepare_certificate', petId, expectedRevision: pet.photo_revision }).then((prepared) => {
      if (!isPatientPhotoDataUrl(prepared?.photoDataUrl)) throw new Error('The patient photo could not be loaded. Please retry.')
      if (active) setPhoto({ key: photoKey, dataUrl: prepared.photoDataUrl })
    }).catch((failure) => { if (active) setPhoto({ key: photoKey, error: failure.message }) })
    return () => { active = false }
  }, [photoKey, petId, pet?.photo_revision, photoRetry])
  const patientPhoto = photo?.key === photoKey ? photo : null
  const owner = data.owners.find((entry) => entry.id === pet?.ownerId)
  const issuer = data.profiles.find((entry) => entry.id === issuerId)
  const vaccination = data.vaccinations.find((entry) => entry.id === rabiesId)
  const candidates = completedTravelVaccinations(data.vaccinations, petId, data.today)
  const errors = travelCertificateErrors({ pet, owner, issuer, vaccination, travelDate, today: data.today })
  if (!destination.trim()) errors.push('Enter the travel destination.')
  if (photoKey && !patientPhoto?.dataUrl) errors.push(patientPhoto?.error || 'Wait for the patient photo to load before issuing.')
  const document = pet && owner && issuer ? travelCertificatePreview({ pet, owner, issuer, vaccinations: data.vaccinations,
    rabiesVaccinationId: rabiesId, today: data.today, travelDate, destination, clinic: data.settings, patientPhotoDataUrl: patientPhoto?.dataUrl }) : null
  const change = (setter) => (event) => { setter(event.target.type === 'checkbox' ? event.target.checked : event.target.value); setPreviewing(false); setError('') }
  const issue = async (event) => {
    event.preventDefault()
    if (busy || !previewing || errors.length || !rabiesConfirmed || !eligibilityConfirmed) return
    setBusy(true); setError('')
    try {
      const saved = await mutate('issue_travel_certificate', { petId, issuerId, travelDate, destination: destination.trim(), rabiesVaccinationId: rabiesId, rabiesConfirmed, eligibilityConfirmed, patientPhotoRevision: pet.photo_revision || 0, isPublic })
      // A confirmed issue never goes back through issuance if loading/printing later fails.
      onIssued(saved)
    } catch (failure) { setError(clinicErrorMessage(failure)) }
    finally { setBusy(false) }
  }
  return <Modal title="Issue travel certificate" description="Review the pet’s vaccination records for the planned journey. This is a clinic-issued document." wide onClose={onClose}>
    <form className="travel-certificate-form" onSubmit={issue} aria-busy={busy}>
      {error && <p className="auth-message auth-error" role="alert">{error}</p>}
      <fieldset className="record-fieldset" disabled={busy}><div className="form-grid">
        <Field label="Pet" required><Combobox label="Pet for travel certificate" value={petId} required options={data.pets.filter((entry) => entry.status === 'Active' && data.owners.some((person) => person.id === entry.ownerId && person.isActive))
          .map((entry) => ({ value: entry.id, label: entry.name, detail: `${data.getOwner(entry.ownerId)?.fullName || ''} · ${entry.recordNumber || ''}` }))}
          onChange={(value) => { setPetId(value); setRabiesId(''); setRabiesConfirmed(false); setEligibilityConfirmed(false); setPreviewing(false) }} placeholder="Search pet, owner or record number" /></Field>
        <Field label="Date of issuance"><input value={data.today} readOnly /></Field>
        <Field label="Planned travel date" required><input type="date" required min={data.today} value={travelDate} onChange={change(setTravelDate)} /></Field>
        <Field label="Destination" required><input required maxLength={300} value={destination} onChange={change(setDestination)} placeholder="City, province or country" /></Field>
        <Field label="Veterinarian" required><select value={issuerId} required onChange={change(setIssuerId)}><option value="">Select veterinarian</option>{data.profiles.filter((entry) => entry.is_active).map((entry) => <option value={entry.id} key={entry.id}>{entry.full_name || 'Clinic staff'}</option>)}</select></Field>
        <Field label="Veterinarian credentials"><p className="travel-issuer-details">PRC License No.: {issuer?.prc_license_number || 'Not recorded'}<br />PTR No.: {issuer?.ptr_number || 'Not recorded'}</p></Field>
        <Field label="Anti-Rabies vaccination record" required span hint="Select and confirm the Anti-Rabies record. Valid-through dates use the recorded next-dose date.">
          <select value={rabiesId} required onChange={(event) => { setRabiesId(event.target.value); setRabiesConfirmed(false); setPreviewing(false) }}>
            <option value="">Select a completed vaccination</option>{candidates.map((entry) => <option value={entry.id} key={entry.id}>{entry.vaccine} · {entry.brand || 'Brand not recorded'} · {entry.administeredAt} · valid through {entry.nextDueAt || 'not recorded'}</option>)}
          </select>
        </Field>
        <Field label="Certificate visibility" span hint="Public lets anyone with the QR code or link view this certificate, including the owner’s name, travel details and patient photo. You can change this after issuance."><select value={isPublic ? 'public' : 'private'} onChange={(event) => { setIsPublic(event.target.value === 'public'); setPreviewing(false) }}><option value="private">Private — clinic staff only</option><option value="public">Public — anyone with the QR or link</option></select></Field>
      </div>
      {photoKey && !patientPhoto?.dataUrl && <p className="auth-message" role={patientPhoto?.error ? 'alert' : 'status'}>{patientPhoto?.error || 'Loading the patient photo for this certificate…'}{patientPhoto?.error && <button type="button" className="text-link" onClick={() => { setPhoto(null); setPhotoRetry((value) => value + 1) }}>Retry patient photo</button>}</p>}
      {pet && !candidates.length && <p className="auth-message">No completed vaccination records are available. Complete or record the vaccination before issuing.</p>}
      {pet && <Link className="text-link" to={`/patients/${encodeURIComponent(pet.id)}?tab=vaccines`}>Review or correct this pet’s vaccination records</Link>}
      <div className="travel-confirmations">
        <label><input type="checkbox" checked={rabiesConfirmed} required onChange={change(setRabiesConfirmed)} /> I confirm the selected vaccination is Anti-Rabies.</label>
        <label><input type="checkbox" checked={eligibilityConfirmed} required onChange={change(setEligibilityConfirmed)} /> I have reviewed the pet’s records and eligibility for the stated journey.</label>
      </div>
      {previewing && <>{errors.length > 0 && <div className="auth-message auth-error" role="alert"><strong>Complete these checks before issuance:</strong><ul>{errors.map((message) => <li key={message}>{message}</li>)}</ul></div>}{document && <DocumentPreview certificate={document} />}</>}
      <div className="form-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="button button-secondary" onClick={() => { setPreviewing(true); setError('') }}>Preview certificate</button>
        {previewing && <button type="submit" className="button button-primary" disabled={errors.length > 0}>{busy ? 'Issuing...' : 'Issue certificate'}</button>}
      </div></fieldset>
    </form>
  </Modal>
}

function CertificateViewer({ id, reference, mutate, onChanged, onClose }) {
  const { profile } = useAuth()
  const [certificate, setCertificate] = useState(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [printing, setPrinting] = useState(false)
  const [voiding, setVoiding] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [visibility, setVisibility] = useState(null)
  const [sharingMessage, setSharingMessage] = useState('')
  const [sharingUncertain, setSharingUncertain] = useState(false)
  const [visibilityMutation, setVisibilityMutation] = useState(() => createMutationRunner(supabase))
  useEffect(() => {
    let active = true
    setError('')
    fetchTravelCertificate(id).then((record) => { if (active) setCertificate(record) }).catch((failure) => { if (active) setError(failure.message) })
    return () => { active = false }
  }, [id, revision])
  const print = async () => {
    if (printing) return
    setPrinting(true); setError('')
    try { const latest = await fetchTravelCertificate(id); setCertificate(latest); await printTravelCertificate(latest) }
    catch { setError('The saved certificate could not be prepared for printing. Please retry Print / PDF.') }
    finally { setPrinting(false) }
  }
  return <Modal title={reference ? `Certificate ${reference}` : 'Travel certificate'} description="This saved document retains the details and reference recorded at issuance." wide onClose={onClose}>
    {error && <p className="auth-message auth-error" role="alert">{error}</p>}
    {!certificate ? <><p role="status">{error ? 'The saved certificate is available for retry.' : 'Loading saved certificate...'}</p>{error && <button className="button button-secondary" onClick={() => setRevision((value) => value + 1)}>Retry loading certificate</button>}</> : <>
      {certificate.status === 'void' && <p className="auth-message auth-error" role="status"><strong>VOID CERTIFICATE</strong> · {certificate.void_reason}</p>}
      <section className="travel-sharing-panel" aria-label="Certificate sharing">
        <div><h3>QR code &amp; public viewing</h3><p>{certificate.is_public ? 'Anyone with the QR code or link can view this certificate without signing in.' : 'Private. The QR link does not display this certificate publicly.'}</p>
          <Field label="Certificate visibility" hint="Public shares the owner’s name, travel details, vaccination history and patient photo."><select disabled={busy} value={visibility ?? (certificate.is_public ? 'public' : 'private')} onChange={(event) => { setVisibility(event.target.value); setSharingMessage(''); setVisibilityMutation(() => createMutationRunner(supabase)) }}><option value="private">Private — clinic staff only</option><option value="public">Public — anyone with the QR or link</option></select></Field>
          <button type="button" className="button button-secondary" disabled={busy || visibility == null || (!sharingUncertain && (visibility === 'public') === Boolean(certificate.is_public))} onClick={async () => {
            setBusy(true); setError(''); setSharingMessage('')
            try {
              await visibilityMutation('set_travel_certificate_visibility', { id, isPublic: visibility === 'public' })
              setSharingUncertain(false)
              setCertificate((current) => ({ ...current, is_public: visibility === 'public' })); setVisibility(null); onChanged()
              setSharingMessage(visibility === 'public' ? 'Public viewing enabled.' : 'Public viewing disabled. The certificate is private.')
            } catch (failure) { setSharingUncertain(true); setError(clinicErrorMessage(failure)) }
            finally { setBusy(false) }
          }}>{busy ? 'Saving...' : 'Save visibility'}</button>
          {sharingMessage && <p role="status">{sharingMessage}</p>}
        </div>
        {certificate.qrDataUrl && <div className="travel-sharing-qr"><img src={certificate.qrDataUrl} alt="Scan to view this travel certificate" width="160" height="160" /><a href={certificate.verificationUrl} target="_blank" rel="noopener noreferrer" className="text-link">Open QR link</a><a href={certificate.qrDataUrl} download={`${certificate.reference_number}-qr.png`} className="text-link">Download QR</a></div>}
      </section>
      <DocumentPreview certificate={certificate} />
      <div className="form-actions"><button type="button" className="button button-primary" disabled={printing || busy} onClick={print}><Printer size={17} />{printing ? 'Preparing...' : 'Print / PDF'}</button>
        {profile.role === 'owner' && certificate.status === 'issued' && <button type="button" disabled={busy} className="button button-secondary danger-text" onClick={() => setVoiding(true)}>Void certificate</button>}</div>
      {voiding && <form aria-busy={busy} onSubmit={async (event) => {
        event.preventDefault(); if (busy) return; setBusy(true); setError('')
        try { await mutate('void_travel_certificate', { id, reason: reason.trim() }); setCertificate((current) => ({ ...current, status: 'void', void_reason: reason.trim() })); setVoiding(false); setRevision((value) => value + 1); onChanged() }
        catch (failure) { setError(clinicErrorMessage(failure)) }
        finally { setBusy(false) }
      }}><fieldset className="record-fieldset" disabled={busy}><Field label="Reason for voiding" required><textarea required maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} /></Field><div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setVoiding(false)}>Cancel void</button><button className="button button-primary" type="submit">{busy ? 'Voiding...' : 'Confirm void'}</button></div></fieldset></form>}
    </>}
  </Modal>
}

export default function TravelCertificates() {
  const [params, setParams] = useSearchParams()
  const [mutate] = useState(() => createMutationRunner(supabase))
  const [modal, setModal] = useState(() => params.get('petId') ? { type: 'issue', petId: params.get('petId') } : null)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState({ records: [], count: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [printingId, setPrintingId] = useState('')
  useEffect(() => {
    if (params.has('petId')) { const next = new URLSearchParams(params); next.delete('petId'); setParams(next, { replace: true }) }
  }, [params, setParams])
  const reload = () => setRevision((value) => value + 1)
  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true); setError('')
      try { const rows = await fetchTravelCertificates({ query, page, signal: controller.signal }); if (!controller.signal.aborted) setResult(rows) }
      catch (failure) { if (!controller.signal.aborted) setError(failure.message) }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }, 200)
    return () => { clearTimeout(timer); controller.abort() }
  }, [query, page, revision])
  const pageCount = useMemo(() => Math.max(1, Math.ceil(result.count / CERTIFICATE_PAGE_SIZE)), [result.count])
  return <div className="page travel-certificates-page">
    <PageHeader eyebrow="Clinic documents" title="Travel Certificates" description="Issue pet-specific clinic certificates from saved vaccination records." actions={<button className="button button-primary" onClick={() => setModal({ type: 'issue' })}><Plus size={18} />Issue certificate</button>} />
    <div className="list-toolbar"><Field label="Search certificates"><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0) }} placeholder="Reference, pet or owner" /></Field><button className="button button-secondary" onClick={reload} disabled={loading}>Refresh certificates</button></div>
    {error && <p className="auth-message auth-error" role="alert">{error}</p>}
    {loading && <p role="status">Loading certificates...</p>}
    <div className="record-directory" aria-busy={loading}>{result.records.map((record) => <article className="section-card directory-card" key={record.id}>
      <div><h2>{record.reference_number}</h2><p><strong>{record.pet_name}</strong> · {record.owner_name}</p><p>Issued {record.issued_on} · {record.issuer_name}</p><p>Travel {record.travel_date} · {record.destination}</p><div className="travel-certificate-badges"><Badge tone={record.status === 'void' ? 'danger' : 'success'}>{record.status === 'void' ? 'Void' : 'Issued'}</Badge><Badge tone={record.is_public ? 'blue' : 'neutral'}>{record.is_public ? 'Public' : 'Private'}</Badge></div></div>
      <div className="record-actions"><button type="button" className="button button-secondary" onClick={() => setModal({ type: 'view', id: record.id, reference: record.reference_number })}>View</button><button type="button" className="button button-secondary" disabled={Boolean(printingId)} onClick={async () => {
        setPrintingId(record.id); setError('')
        try { await printTravelCertificate(await fetchTravelCertificate(record.id)) }
        catch { setError('The saved certificate could not be prepared for printing. Please retry Print / PDF.') }
        finally { setPrintingId('') }
      }}><Printer size={17} />{printingId === record.id ? 'Preparing...' : 'Print / PDF'}</button></div>
    </article>)}</div>
    {!loading && !error && !result.records.length && <EmptyState icon={FileText} title="No travel certificates found" description="Issue a certificate for a pet or try another reference, pet or owner name." />}
    <div className="travel-pagination"><button className="button button-secondary" disabled={loading || page === 0} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {page + 1} of {pageCount}</span><button className="button button-secondary" disabled={loading || page + 1 >= pageCount} onClick={() => setPage((value) => value + 1)}>Next</button></div>
    {modal?.type === 'issue' && <IssueCertificate initialPetId={modal.petId} mutate={mutate} onClose={() => setModal(null)} onIssued={(saved) => { setModal({ type: 'view', id: saved.id, reference: saved.referenceNumber }); setPage(0); reload() }} />}
    {modal?.type === 'view' && <CertificateViewer key={modal.id} id={modal.id} reference={modal.reference} mutate={mutate} onChanged={reload} onClose={() => setModal(null)} />}
  </div>
}
