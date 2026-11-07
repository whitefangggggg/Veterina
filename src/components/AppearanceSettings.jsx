import { useState } from 'react'
import { Desktop, Moon, Sun } from '@phosphor-icons/react'
import { useAppearance } from '../context/AppearanceContext'
import { useAuth } from '../context/AuthContext'
import { useClinicData } from '../context/ClinicDataContext'
import { clinicThemes, clinicThemeStyle } from '../lib/clinicPersonalization'
import { SectionCard } from './ui'
import './AppearanceSettings.css'

const modes = [
  { value: 'light', label: 'Light', detail: 'Bright surfaces and dark text', icon: Sun },
  { value: 'dark', label: 'Dark', detail: 'Dark surfaces and light text', icon: Moon },
  { value: 'system', label: 'System', detail: 'Follow your device appearance', icon: Desktop },
]

export default function AppearanceSettings() {
  const { mode, setMode } = useAppearance()
  const { profile } = useAuth()
  const { settings, execute } = useClinicData()
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const saved = settings?.brand_color || clinicThemes[0].color
  const selected = draft || saved
  const save = async (event) => {
    event.preventDefault()
    if (busy || selected === saved) return
    setBusy(true); setError(''); setMessage('')
    try {
      await execute('set_clinic_theme', { brandColor: selected }, { requireRefresh: true })
      setDraft(null); setMessage('Clinic color saved.')
    } catch (error) { setError(error.message) }
    finally { setBusy(false) }
  }

  return <div className="appearance-settings">
    <SectionCard title="Display mode" description="Choose how Veterina looks on this browser. This applies to every page and is shared by accounts using this browser.">
      <fieldset className="appearance-options settings-panel"><legend className="sr-only">Display mode</legend>
        {modes.map(({ value, label, detail, icon: Icon }) => <label className="appearance-option" key={value}>
          <input type="radio" name="appearance" value={value} checked={mode === value} onChange={() => setMode(value)} />
          <Icon size={25} aria-hidden="true" /><strong>{label}</strong><small>{detail}</small>
        </label>)}
      </fieldset>
    </SectionCard>
    {profile.role === 'owner' && <SectionCard title="Clinic color theme" description="Choose the accent color shared by everyone in your clinic. Save to apply it throughout the clinic workspace.">
      <form className="settings-panel" onSubmit={save} aria-busy={busy}>
        <fieldset className="clinic-theme-options" disabled={busy}><legend className="sr-only">Clinic color theme</legend>
          {clinicThemes.map((theme) => <label className="clinic-theme-option" key={theme.color}>
            <input type="radio" name="clinicColor" value={theme.color} checked={selected === theme.color} onChange={() => { setDraft(theme.color); setError(''); setMessage('') }} />
            <span className="clinic-theme-swatch" style={{ background: theme.color }} aria-hidden="true" /><strong>{theme.name}</strong>
          </label>)}
        </fieldset>
        <div className="clinic-theme-preview" style={clinicThemeStyle(selected)} aria-label="Clinic color preview">
          <span className="clinic-theme-preview-icon" aria-hidden="true">V</span><div><strong>{settings?.clinic_name || 'Your clinic'}</strong><p>Patient records, appointments, and care</p></div><span className="clinic-theme-preview-button">Sample button</span>
        </div>
        {error && selected !== saved && <p className="auth-message auth-error" role="alert">{error}</p>}
        {message && <p className="auth-message" role="status">{message}</p>}
        <div className="form-actions"><button type="submit" className="button button-primary" disabled={busy || selected === saved}>{busy ? 'Saving...' : 'Save clinic color'}</button></div>
      </form>
    </SectionCard>}
  </div>
}
