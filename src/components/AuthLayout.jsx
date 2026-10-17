import { Link } from 'react-router-dom'
import { ShieldCheck, Stethoscope } from '@phosphor-icons/react'

export default function AuthLayout({ title, description, children }) {
  return (
    <main className="auth-page">
      <Link to="/" className="auth-brand" aria-label="Veterina home">
        <span><Stethoscope size={28} weight="duotone" /></span>
        <strong>Veterina<small>Clinic care system</small></strong>
      </Link>
      <section className="auth-card" aria-labelledby="auth-title">
        <p className="eyebrow">A calmer clinic day starts here</p>
        <h1 id="auth-title">{title}</h1>
        <p className="auth-description">{description}</p>
        {children}
      </section>
      <p className="auth-footnote"><ShieldCheck size={19} aria-hidden="true" /> Clinic workspaces are reserved for approved staff.</p>
    </main>
  )
}
