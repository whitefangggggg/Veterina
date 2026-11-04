import { useEffect, useState } from 'react'
import { ImageSquare } from '@phosphor-icons/react'
import { useClinicData } from '../context/ClinicDataContext'
import { supabase } from '../lib/supabaseClient'
import { prepareClinicLogo } from '../lib/clinicLogo'
import { SectionCard } from './ui'

export default function ClinicLogoSettings() {
  const { settings, reload } = useClinicData()
  const [savedLogo, setSavedLogo] = useState(settings?.logo_data_url || null)
  const [draft, setDraft] = useState(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  useEffect(() => { setSavedLogo(settings?.logo_data_url || null) }, [settings?.logo_data_url])
  const preview = draft === undefined ? savedLogo : draft
  const changed = draft !== undefined && draft !== savedLogo
  const choose = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || busy) return
    setBusy(true); setError(''); setMessage('')
    try { setDraft(await prepareClinicLogo(file)) }
    catch (error) { setError(error.message) }
    finally { setBusy(false) }
  }
  const save = async (event) => {
    event.preventDefault()
    if (busy || !changed) return
    setBusy(true); setError(''); setMessage('')
    try {
      const { error } = await supabase.rpc('save_clinic_logo', { p_logo: preview })
      if (error) throw error
      setSavedLogo(preview); setDraft(undefined)
      await reload()
      setMessage(preview ? 'Shop logo saved. Prescriptions will use this logo.' : 'Shop logo removed.')
    } catch { setError('The shop logo could not be saved. Please try again.') }
    finally { setBusy(false) }
  }
  return <SectionCard title="Shop logo" description="Used on prescription prints, PDFs and PNG downloads.">
    <form className="settings-panel clinic-logo-form" onSubmit={save} aria-busy={busy}>
      {error && <p className="auth-message auth-error" role="alert">{error}</p>}
      {message && <p className="auth-message" role="status">{message}</p>}
      <fieldset disabled={busy} className="record-fieldset">
        <div className="clinic-logo-upload">
          <div className="clinic-logo-preview">{preview ? <img src={preview} alt="Shop logo preview" /> : <div><ImageSquare size={36} aria-hidden="true" /><span>No logo uploaded</span></div>}</div>
          <div className="clinic-logo-controls">
            <label className="field"><span>{preview ? 'Replace shop logo' : 'Upload shop logo'}</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={choose} aria-describedby="shop-logo-help" /></label>
            <p id="shop-logo-help">PNG, JPEG or WebP, up to 5 MB. A square image with a clear background works best.</p>
            {preview && <button type="button" className="text-link" onClick={() => { setDraft(null); setError(''); setMessage('') }}>Remove logo</button>}
          </div>
        </div>
        <div className="form-actions"><button type="submit" className="button button-primary" disabled={!changed}>{busy ? 'Please wait...' : 'Save logo'}</button>{changed && <button type="button" className="button button-secondary" onClick={() => { setDraft(undefined); setError(''); setMessage('') }}>Cancel logo changes</button>}</div>
      </fieldset>
    </form>
  </SectionCard>
}
