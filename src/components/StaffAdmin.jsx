import { useCallback, useEffect, useState } from 'react'
import { invokeClinicFunction } from '../lib/reports'
import { useClinicData } from '../context/ClinicDataContext'
import { RecordEditor } from './RecordForm'
import { Badge } from './ui'

export default function StaffAdmin() {
  const { reload } = useClinicData()
  const [accounts, setAccounts] = useState(null)
  const [modal, setModal] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    setBusy(true); setError('')
    try {
      const result = await invokeClinicFunction('admin-staff', { action: 'list' })
      setAccounts(result.accounts.filter((account) => account.status === 'pending' && account.role === 'clinical_staff'))
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  return <div className="staff-admin">
    <h2>Pending staff approvals</h2>
    <p>Staff who registered using your shop’s Veterina Code appear here. They must confirm their email before you can approve access.</p>
    {error && <p className="auth-message auth-error" role="alert">{error}</p>}
    <div className="record-actions"><button className="button button-secondary" onClick={load} disabled={busy}>{busy ? 'Loading...' : 'Refresh pending accounts'}</button></div>
    {accounts?.length === 0 && <p role="status">No pending staff registrations for your shop.</p>}
    {accounts && <div className="record-directory">{accounts.map((account) => <article className="directory-card" key={account.id}>
      <div><h3>{account.full_name}</h3><p>{account.email}</p><Badge>Clinical staff</Badge><Badge tone={account.email_confirmed ? 'success' : 'warning'}>{account.email_confirmed ? 'Email confirmed' : 'Email confirmation pending'}</Badge></div>
      <div className="record-actions">
        <button className="button button-primary small-button" disabled={busy || !account.email_confirmed} onClick={() => setModal(account)}>Approve account</button>
        <button className="text-link danger-text" disabled={busy} onClick={() => setModal({ ...account, reject: true })}>Reject request</button>
      </div>
    </article>)}</div>}
    {modal && <RecordEditor title={modal.reject ? 'Reject registration request?' : 'Approve staff account'} description={modal.email}
      initial={{ full_name: modal.full_name }} onClose={() => setModal(null)} submitLabel={modal.reject ? 'Reject request' : 'Approve staff'}
      fields={modal.reject ? [] : [{ name: 'full_name', label: 'Approved full name', required: true, maxLength: 120 }]}
      onSave={async (values) => {
        await invokeClinicFunction('admin-staff', { action: modal.reject ? 'reject' : 'approve', id: modal.id, ...values, role: 'clinical_staff' })
        await load(); await reload()
      }} />}
  </div>
}
