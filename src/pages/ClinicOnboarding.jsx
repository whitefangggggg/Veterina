import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, ImageSquare, PawPrint, SignOut, Stethoscope } from '@phosphor-icons/react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useClinicData } from '../context/ClinicDataContext'
import { supabase } from '../lib/supabaseClient'
import { clinicErrorMessage } from '../lib/clinicRepository'
import { prepareClinicLogo } from '../lib/clinicLogo'
import { clinicDays, clinicThemes, clinicThemeStyle, initialClinicSetup, validateClinicSetup } from '../lib/clinicPersonalization'
import './ClinicOnboarding.css'

const steps = [
  { label: 'Clinic details', title: 'Let’s meet your clinic.', description: 'Start with the details pet owners use to find and contact you.' },
  { label: 'Make it yours', title: 'A familiar face for your clinic.', description: 'Add your clinic image or logo and choose a color that feels like you.' },
  { label: 'Your clinic day', title: 'Set the rhythm of your day.', description: 'Choose your timezone, opening hours, and when reminders become due.' },
  { label: 'Ready to go', title: 'Your Veterina, ready for care.', description: 'Take a look before you open your clinic workspace. You can change these details later.' },
]

export default function ClinicOnboarding({ revisiting, onFinished }) {
  const { settings } = useClinicData()
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [values, setValues] = useState(() => initialClinicSetup(settings))
  const [step, setStep] = useState(() => revisiting ? 0 : Math.min(3, Math.max(0, settings?.onboarding_step || 0)))
  const [busy, setBusy] = useState(false)
  const [preparingImage, setPreparingImage] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const heading = useRef(null)
  const photoRequest = useRef(0)
  useEffect(() => { heading.current?.focus() }, [step])
  useEffect(() => () => { photoRequest.current += 1 }, [])
  const change = (name, value) => { setValues((current) => ({ ...current, [name]: value })); setError(''); setStatus('') }
  const field = (name) => ({ value: values[name], onChange: (event) => change(name, event.target.value) })
  const hasHours = Object.keys(values.businessHours).length > 0
  const toggleHours = (enabled) => change('businessHours', enabled ? Object.fromEntries(clinicDays.map(([day]) => [day, { closed: day === 'sun', open: '09:00', close: '17:00' }])) : {})
  const changeHours = (day, name, value) => change('businessHours', { ...values.businessHours, [day]: { ...values.businessHours[day], [name]: value } })

  const chooseImage = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || busy) return
    const request = ++photoRequest.current
    setPreparingImage(true); setError('')
    try {
      const image = await prepareClinicLogo(file)
      if (request === photoRequest.current) change('logoDataUrl', image)
    } catch (failure) { if (request === photoRequest.current) setError(failure.message) }
    finally { if (request === photoRequest.current) setPreparingImage(false) }
  }

  const save = async (complete, nextStep = step) => {
    if (busy || preparingImage) return
    setError(''); setStatus('')
    if (complete || nextStep !== step) {
      const message = validateClinicSetup(values, complete ? 3 : step)
      if (message) { setError(message); return }
    }
    setBusy(true)
    try {
      const { error: failure } = await supabase.rpc('save_clinic_onboarding', { p_data: { ...values, step: nextStep }, p_complete: complete })
      if (failure) throw failure
      if (complete) await onFinished()
      else { setStep(nextStep); setStatus('Your progress is saved.') }
    } catch (failure) { setError(clinicErrorMessage(failure)) }
    finally { setBusy(false) }
  }
  const leave = async () => {
    if (busy || preparingImage) return
    setBusy(true); setError('')
    try { await signOut() }
    catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }

  return <main className="clinic-onboarding" style={clinicThemeStyle(values.brandColor)}>
    <header className="onboarding-topbar"><div className="onboarding-veterina"><Stethoscope size={25} weight="duotone" /><strong>Veterina</strong><span>Your clinic. Your way.</span></div><button type="button" className="text-link" disabled={busy || preparingImage} onClick={leave}><SignOut size={17} />Sign out</button></header>
    <div className="onboarding-layout">
      <aside className="onboarding-intro"><span className="eyebrow">WELCOME, {profile.full_name || 'CLINIC OWNER'}</span><h2>A home for the care<br />only you can give.</h2><p>A few details will make your workspace feel like your clinic, from the first appointment to the final prescription.</p>
        <ol className="onboarding-steps" aria-label="Clinic setup progress">{steps.map((item, index) => <li key={item.label} aria-current={step === index ? 'step' : undefined}><span>{index < step ? <Check size={17} weight="bold" /> : `0${index + 1}`}</span><div><strong>{item.label}</strong><small>{index < step ? 'Saved' : index === step ? 'You are here' : 'Coming up'}</small></div></li>)}</ol>
        <div className="onboarding-progress-note"><PawPrint size={20} weight="duotone" /><span>Progress saves as you go. Come back whenever you need.</span></div>
      </aside>
      <section className="onboarding-card" aria-labelledby="clinic-setup-title"><p className="eyebrow">STEP {step + 1} OF 4</p><h1 id="clinic-setup-title" ref={heading} tabIndex={-1}>{steps[step].title}</h1><p className="onboarding-description">{steps[step].description}</p>
        <form onSubmit={(event) => { event.preventDefault(); void save(step === 3, Math.min(3, step + 1)) }} aria-busy={busy || preparingImage}>
          {error && <p className="auth-message auth-error" role="alert">{error}</p>}
          {status && <p className="onboarding-saved" role="status"><Check size={16} />{status}</p>}
          <fieldset className="record-fieldset" disabled={busy || preparingImage}>
            {step === 0 && <div className="onboarding-fields">
              <label>Clinic name <span aria-hidden="true">*</span><input name="clinicName" autoComplete="organization" required maxLength={160} {...field('clinicName')} placeholder="e.g. Paws & Care Veterinary Clinic" /></label>
              <label>Clinic address <span aria-hidden="true">*</span><textarea name="address" autoComplete="street-address" required rows={2} maxLength={500} {...field('address')} placeholder="Street, barangay, city, province, and postal code" /></label>
              <div className="onboarding-field-row"><label>Clinic phone <span aria-hidden="true">*</span><input name="phone" type="tel" autoComplete="tel" required maxLength={60} {...field('phone')} placeholder="Your clinic’s contact number" /></label><label>Clinic email<input name="email" type="email" autoComplete="email" maxLength={254} {...field('email')} placeholder="hello@yourclinic.com" /></label></div>
              <label>Clinic website <small>Optional</small><input name="website" type="url" autoComplete="url" maxLength={254} {...field('website')} placeholder="https://yourclinic.com" /></label>
              <p className="onboarding-hint">Your clinic details also appear on prescriptions and printed documents.</p>
            </div>}
            {step === 1 && <div className="onboarding-fields">
              <div className="onboarding-image-row"><div className="onboarding-image-preview">{values.logoDataUrl ? <img src={values.logoDataUrl} alt="Clinic image preview" /> : <ImageSquare size={38} weight="duotone" />}</div><div><label>Clinic image or logo <small>Optional</small><input type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseImage} /></label><p className="onboarding-hint">PNG, JPEG, or WebP, up to 5 MB. Used in your workspace and on prescriptions.</p>{values.logoDataUrl && <button type="button" className="text-link" onClick={() => change('logoDataUrl', null)}>Remove image</button>}</div></div>
              <label>Clinic tagline <small>Optional</small><input name="tagline" maxLength={160} {...field('tagline')} placeholder="e.g. Thoughtful care for every paw" /></label>
              <fieldset className="onboarding-colors"><legend>Choose your clinic color</legend><div>{clinicThemes.map((theme) => <label key={theme.color} title={theme.name} style={{ '--swatch': theme.color }}><input type="radio" name="brandColor" value={theme.color} checked={values.brandColor === theme.color} onChange={() => change('brandColor', theme.color)} /><span aria-hidden="true">{values.brandColor === theme.color && <Check size={18} weight="bold" />}</span><small>{theme.name}</small></label>)}</div></fieldset>
              <ClinicPreview values={values} />
            </div>}
            {step === 2 && <div className="onboarding-fields">
              <label>Clinic timezone <span aria-hidden="true">*</span><input name="timezone" list="clinic-timezones" required maxLength={100} {...field('timezone')} /><datalist id="clinic-timezones">{['Asia/Manila','Asia/Singapore','Asia/Hong_Kong','Asia/Tokyo','Asia/Bangkok','Australia/Sydney','Europe/London','America/New_York','America/Los_Angeles','UTC'].map((zone) => <option value={zone} key={zone} />)}</datalist></label>
              <label>Reminder lead days<input name="reminderLeadDays" type="number" min="0" max="365" step="1" required {...field('reminderLeadDays')} /><small>How many days before a due date reminders should appear in your worklist.</small></label>
              <label className="onboarding-hours-toggle"><input type="checkbox" checked={hasHours} onChange={(event) => toggleHours(event.target.checked)} />Add clinic opening hours</label>
              {hasHours && <div className="onboarding-hours"><p className="onboarding-hint">Shown in your clinic profile. Appointment times are still chosen when booking.</p>{clinicDays.map(([day, label]) => { const hours = values.businessHours[day] || { closed: true, open: '09:00', close: '17:00' }; return <div key={day} className="onboarding-hours-row"><strong>{label}</strong><label><input type="checkbox" aria-label={`${label} closed`} checked={hours.closed} onChange={(event) => changeHours(day, 'closed', event.target.checked)} />Closed</label>{!hours.closed && <div><input aria-label={`${label} opens`} type="time" required value={hours.open || ''} onChange={(event) => changeHours(day, 'open', event.target.value)} /><span>to</span><input aria-label={`${label} closes`} type="time" required value={hours.close || ''} onChange={(event) => changeHours(day, 'close', event.target.value)} /></div>}</div> })}</div>}
            </div>}
            {step === 3 && <div className="onboarding-review"><ClinicPreview values={values} /><dl><div><dt>Clinic address</dt><dd>{values.address || 'Not added'}</dd></div><div><dt>Contact</dt><dd>{values.phone || 'Not added'}{values.email && <><br />{values.email}</>}</dd></div>{values.website && <div><dt>Website</dt><dd>{values.website}</dd></div>}<div><dt>Timezone</dt><dd>{values.timezone}</dd></div><div><dt>Reminders</dt><dd>{values.reminderLeadDays} days before the due date</dd></div><div><dt>Opening hours</dt><dd>{hasHours ? clinicDays.filter(([day]) => values.businessHours[day]).map(([day, label]) => <span className="onboarding-review-hours" key={day}>{label}: {values.businessHours[day].closed ? 'Closed' : `${values.businessHours[day].open} – ${values.businessHours[day].close}`}</span>) : 'Not added — you can add them later'}</dd></div></dl><p className="onboarding-hint">Your clinic’s Veterina Code is ready in Settings when you want to invite staff.</p></div>}
            <div className="onboarding-actions"><div>{step > 0 ? <button type="button" className="button button-secondary" onClick={() => { setStep(step - 1); setError(''); setStatus('') }}><ArrowLeft size={16} />Back</button> : revisiting ? <button type="button" className="button button-secondary" onClick={() => navigate('/settings')}>Back to settings</button> : null}</div><button type="submit" className="button button-primary">{busy ? 'Saving...' : preparingImage ? 'Preparing image...' : step === 3 ? 'Open my clinic' : 'Save & continue'}{step === 3 ? <Check size={17} /> : <ArrowRight size={17} />}</button></div>
            <button type="button" className="onboarding-save-later text-link" onClick={() => void save(false)}>Save progress for later</button>
          </fieldset>
        </form>
      </section>
    </div>
  </main>
}

function ClinicPreview({ values }) {
  return <div className="onboarding-clinic-preview" aria-label="Clinic branding preview"><div>{values.logoDataUrl ? <img src={values.logoDataUrl} alt="" /> : <PawPrint size={29} weight="duotone" />}</div><section><strong>{values.clinicName || 'Your clinic name'}</strong><p>{values.tagline || 'A little more care, every day.'}</p><small>Powered by Veterina</small></section></div>
}
