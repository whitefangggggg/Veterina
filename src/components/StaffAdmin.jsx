import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { invokeClinicFunction } from '../lib/reports'
import { useAuth } from '../context/AuthContext'
import { useClinicData } from '../context/ClinicDataContext'
import { AsyncForm, RecordEditor } from './RecordForm'
import { Badge } from './ui'

export default function StaffAdmin() {
  const { session } = useAuth()
  const { reload } = useClinicData()
  const [assurance, setAssurance] = useState(null)
  const [factor, setFactor] = useState(null)
  const [enrollment, setEnrollment] = useState(null)
  const [accounts, setAccounts] = useState(null)
  const [modal, setModal] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let alive = true
    void Promise.all([supabase.auth.mfa.getAuthenticatorAssuranceLevel(), supabase.auth.mfa.listFactors()]).then(([level, factors]) => {
      if (!alive) return
      if (level.error || factors.error) throw level.error || factors.error
      setAssurance(level.data.currentLevel)
      setFactor(factors.data.totp.find((entry) => entry.status === 'verified') || null)
    }).catch((error) => { if (alive) setError(error.message) })
    return () => { alive = false }
  }, [session.access_token])

  const load = async () => {
    setBusy(true); setError('')
    try { setAccounts(await invokeClinicFunction('admin-staff', { action: 'list' })) }
    catch (error) { setError(error.message) }
    finally { setBusy(false) }
  }
  const enroll = async () => {
    setBusy(true); setError('')
    try {
      const { data: factors, error: factorError } = await supabase.auth.mfa.listFactors()
      if (factorError) throw factorError
      for (const entry of factors.all.filter((entry) => entry.factor_type === 'totp' && entry.status === 'unverified')) {
        const { error } = await supabase.auth.mfa.unenroll({ factorId: entry.id }); if (error) throw error
      }
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Veterina staff administration' })
      if (error) throw error
      setEnrollment(data)
    } catch (error) { setError(error.message) } finally { setBusy(false) }
  }
  const verify = async ({ code }) => {
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrollment?.id || factor.id, code })
    if (error) throw error
    setAssurance('aal2'); setEnrollment(null)
  }
  return <div className="staff-admin">
    <h2>Staff accounts</h2><p>Only clinic owners can approve registrations or change staff roles. Verify with your authenticator before managing accounts.</p>
    {error && <p className="auth-message auth-error" role="alert">{error}</p>}
    {assurance !== 'aal2' ? <div className="mfa-setup">
      {!factor && !enrollment && <button className="button button-primary" disabled={busy || !assurance} onClick={enroll}>Set up authenticator</button>}
      {enrollment && <><img width="200" height="200" src={enrollment.totp.qr_code} alt="Scan this QR code in your authenticator app" /><p>Manual setup key: <code>{enrollment.totp.secret}</code></p></>}
      {(factor || enrollment) && <AsyncForm onSave={verify} submitLabel="Verify authenticator"><label className="field"><span>Six-digit code</span><input name="code" required inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" /></label></AsyncForm>}
    </div> : <><div className="record-actions"><button className="button button-secondary" onClick={load} disabled={busy}>{busy ? 'Loading...' : 'Load staff and pending accounts'}</button><button className="button button-primary" onClick={() => setModal({ invite: true, full_name: '', role: 'clinical_staff' })}>Invite staff</button></div>
      {accounts && <div className="record-directory">{accounts.accounts.map((account) => <article className="directory-card" key={account.id}>
        <div><h3>{account.full_name || account.email}</h3><p>{account.email}</p><Badge>{account.role || 'Awaiting approval'}</Badge>{account.role && <Badge tone={account.is_active ? 'success' : 'neutral'}>{account.is_active ? 'Active' : 'Inactive'}</Badge>}</div>
        <button className="button button-secondary small-button" onClick={() => setModal(account)}>{account.role ? 'Manage access' : 'Approve account'}</button>
      </article>)}</div>}
    </>}
    {modal && <RecordEditor title={modal.invite ? 'Invite staff' : modal.role ? 'Manage staff access' : 'Approve registered account'} initial={{ full_name: modal.full_name, role: modal.role || 'clinical_staff', is_active: modal.is_active ?? true }} onClose={() => setModal(null)}
      fields={[...(modal.invite ? [{ name: 'email', label: 'Email address', type: 'email', required: true }] : []), ...(!modal.role || modal.invite ? [{ name: 'full_name', label: 'Approved full name', required: true }] : []), { name: 'role', label: 'Role', type: 'select', options: [{ value: 'clinical_staff', label: 'Clinical staff' }, { value: 'owner', label: 'Clinic owner' }] }, ...(modal.role && !modal.invite ? [{ name: 'is_active', label: 'Access', type: 'select', options: [{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }] }] : [])]}
      onSave={async (values) => { await invokeClinicFunction('admin-staff', { action: modal.invite ? 'invite' : modal.role ? 'update' : 'approve', id: modal.id, ...values, is_active: values.is_active !== 'false' }); await load(); await reload() }} />}
  </div>
}
