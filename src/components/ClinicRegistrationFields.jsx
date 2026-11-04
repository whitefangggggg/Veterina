import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { QrCode } from '@phosphor-icons/react'
import { normalizeVeterinaCode } from '../lib/clinicAccess'
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient'
import ClinicQrScanner from './ClinicQrScanner'

export default function ClinicRegistrationFields({ accountType, setAccountType, clinicName, setClinicName, veterinaCode, setVeterinaCode, lockedAccountType = false }) {
  const [clinicInfo, setClinicInfo] = useState(null)
  const [scan, setScan] = useState(false)
  useEffect(() => {
    let alive = true
    const code = normalizeVeterinaCode(veterinaCode)
    const timer = setTimeout(async () => {
      if (accountType !== 'staff' || !isSupabaseConfigured || !code) { if (alive) setClinicInfo(null); return }
      try {
        const { data, error } = await supabase.rpc('veterina_code_info', { p_code: code })
        if (alive) setClinicInfo(error ? null : data)
      } catch { if (alive) setClinicInfo(null) }
    }, 300)
    return () => { alive = false; clearTimeout(timer) }
  }, [accountType, veterinaCode])

  return <>
    <div className="account-type-field"><label htmlFor="account-type">Create account as</label><select id="account-type" name="accountType" disabled={lockedAccountType} value={accountType} onChange={(event) => { setAccountType(event.target.value); setScan(false) }} aria-describedby="account-type-help"><option value="owner">Owner</option><option value="staff">Staff</option></select><p className="account-type-help" id="account-type-help">{accountType === 'owner' ? 'Activate a new clinic with a subscription code from the website administrator.' : 'Join an existing clinic after your shop owner approves your account.'}</p></div>
    {accountType === 'owner' && <label htmlFor="clinic-name">Clinic name<input id="clinic-name" name="clinicName" autoComplete="organization" required maxLength={160} value={clinicName} onChange={(event) => setClinicName(event.target.value)} placeholder="Your clinic name" /></label>}
    {accountType === 'staff' && <div className="registration-code-field">
      <label htmlFor="veterina-code">Veterina Code<input id="veterina-code" name="veterinaCode" required maxLength={60} value={veterinaCode} onChange={(event) => { setVeterinaCode(event.target.value); setClinicInfo(null) }} autoComplete="off" spellCheck={false} placeholder="VET-…" aria-describedby="clinic-code-help" /></label>
      <button type="button" className="button button-secondary" onClick={() => setScan(true)}><QrCode size={18} />Scan QR code</button>
      <small id="clinic-code-help">Get this code or QR from your shop owner.</small>
      {clinicInfo?.valid && <p className="registration-clinic-name" role="status">Joining <strong>{clinicInfo.clinicName}</strong> · Owner approval required</p>}
      {clinicInfo && !clinicInfo.valid && <p className="auth-message auth-error" role="status">Code not found. Check the code with your shop owner.</p>}
    </div>}
    {scan && createPortal(<ClinicQrScanner onCode={(code) => { setVeterinaCode(code); setClinicInfo(null); setScan(false) }} onClose={() => setScan(false)} />, document.body)}
  </>
}
