import { Link } from 'react-router-dom'
import { ShieldCheck, ArrowLeft } from '@phosphor-icons/react'
import ClinicDoodle from './ClinicDoodle'
import './AuthLayout.css'

export default function AuthLayout({ title, description, children }) {
  return (
    <main className="auth-page auth-designed">
      <aside className="auth-story">
        <Link to="/" className="auth-home"><ArrowLeft size={17} /> Back to Veterina</Link>
        <div className="auth-story-copy"><p className="auth-overline">THE CLINIC WORKSPACE</p><h2>Every visit.<br />A little more<br /><span>connected.</span></h2><p>Patient records, appointments, vaccinations, and inventory. Your team’s daily work, together in Veterina.</p></div>
        <ClinicDoodle kind="loop" className="auth-ink-loop" /><ClinicDoodle kind="cat" className="auth-ink-cat" /><ClinicDoodle kind="paw" className="auth-ink-paw" />
        <p className="auth-story-bottom">For the people behind the care.</p>
      </aside>
      <div className="auth-form-side">
        <Link to="/" className="auth-brand" aria-label="Veterina home"><img src="/brand/veterina-logo.png" alt="Veterina" width="180" height="60" /></Link>
        <section className="auth-card" aria-labelledby="auth-title">
          <p className="eyebrow">YOUR VETERINA ACCOUNT</p>
          <h1 id="auth-title">{title}</h1>
          <p className="auth-description">{description}</p>
          {children}
        </section>
        <p className="auth-footnote"><ShieldCheck size={17} aria-hidden="true" /> Clinic workspaces are reserved for approved staff.</p>
      </div>
    </main>
  )
}
