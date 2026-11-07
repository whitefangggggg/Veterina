import { Link } from 'react-router-dom'
import { ArrowUpRight, ArrowRight, CalendarBlank, ClipboardText, Syringe, Package, Check } from '@phosphor-icons/react'
import './Landing.css'
import ClinicDoodle from '../components/ClinicDoodle'
import DoctorDino from '../components/DoctorDino'
import { SleepingPatientCat, ExcitedPatientDog } from '../components/PixelPatients'

const features = [
  [ClipboardText, 'Patient records & clinical history', 'Keep pets, owners, vitals, consultation notes, and care plans together. Give every visit the context of the visits before it.'],
  [CalendarBlank, 'Appointments & daily queue', 'Bookings, care due dates and owner follow-ups in one calendar. See what is scheduled and who is waiting.'],
  [Syringe, 'Vaccinations & follow-up tasks', 'Record doses, check next-due dates, and keep track of follow-up calls and their outcomes.'],
  [Package, 'Inventory & suppliers', 'Keep an eye on stock quantities, expiry dates, and movements, with supplier details close at hand.'],
]
const journey = [
  ['Register & arrive', 'Find the patient and owner, then manage their place in the daily queue.'],
  ['Consult & record', 'Review clinical history and document vitals, findings, and the care plan.'],
  ['Plan the next visit', 'Log vaccinations and keep next-due dates and follow-up reminders connected to the patient.'],
]

export default function Landing() {
  return (
    <div className="vt-page" id="top">
      <header className="vt-header">
        <div className="vt-header-inner">
          <a className="vt-brand" href="#top" aria-label="Veterina home"><img src="/brand/veterina-logo.png" alt="Veterina" width="180" height="60" /><span>THE CLINIC WORKSPACE</span></a>
          <nav aria-label="Main navigation"><a href="#workspace">The platform</a><a href="#care">How it works</a></nav>
          <div className="vt-header-actions"><Link className="vt-signin" to="/sign-in">Sign in</Link><Link className="vt-nav-start" to="/create-account">Get started <ArrowUpRight size={17} /></Link></div>
        </div>
      </header>
      <main>
        <section className="vt-hero"><ClinicDoodle kind="loop" className="vt-ink-loop" /><ClinicDoodle kind="cat" className="vt-ink-cat" /><ClinicDoodle kind="paw" className="vt-ink-paw" /><ClinicDoodle kind="care" className="vt-ink-care" />
          <div className="vt-hero-inner">
            <div className="vt-hero-copy">
              <p className="vt-eyebrow">VETERINARY CLINIC MANAGEMENT</p>
              <h1>Know their story.<br /><span>Care for what’s next.</span></h1>
              <p className="vt-intro">Patient records, appointments, vaccinations, and inventory. One shared workspace for the everyday work of your veterinary clinic.</p>
              <div className="vt-actions"><Link className="vt-button" to="/create-account">Get started <ArrowUpRight size={20} /></Link><a href="#workspace">Explore Veterina <ArrowRight size={18} /></a></div>
              <p className="vt-hero-foot">For the front desk. For the care team. For every patient.</p>
            </div>

          </div>
          <DoctorDino />
          <div className="vt-hero-index"><span>01 / THE WORKSPACE</span><p>Good care has a lot of moving parts.<br /><strong>Keep them connected.</strong></p><a href="#workspace" aria-label="Explore the workspace">↓</a></div>
        </section>
        <section className="vt-workspace" id="workspace"><ClinicDoodle kind="loop" className="vt-margin-loop" />
          <div className="vt-section-heading"><p className="vt-eyebrow">LESS SEARCHING. MORE CONTEXT.</p><h2>Your clinic’s daily work,<br />in one place.</h2><p>From a patient’s first record to their next follow-up, Veterina helps your team keep the details in view.</p></div>
          <div className="vt-features">{features.map(([Icon, title, copy], i) => <article key={title}><div className="vt-feature-top"><Icon size={27} weight="regular" /><span>0{i + 1}</span></div><h3>{title}</h3><p>{copy}</p></article>)}</div>
          <SleepingPatientCat />
        </section>
        <section className="vt-journey" id="care"><ClinicDoodle kind="paw" className="vt-margin-paw" />
          <div className="vt-journey-copy"><p className="vt-eyebrow">A DAY AT THE CLINIC</p><h2>Different steps.<br />The same patient.</h2><p>The record should follow the care. Bring the day’s work back to the pet and the person behind each visit.</p><ExcitedPatientDog /><svg className="vt-arrow-doodle" viewBox="0 0 180 70" fill="none" aria-hidden="true"><path d="M5 18c50 57 106 35 143 2m-22 3 24-6-4 23" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
          <div className="vt-record"><header><span className="vt-initial">M</span><div><h3>Milo’s visit</h3><p>Illustrative care journey</p></div><span className="vt-record-label">PATIENT RECORD</span></header>{journey.map(([title, copy], i) => <div className="vt-record-row" key={title}><span className="vt-step">0{i + 1}</span><div><h3>{title}</h3><p>{copy}</p></div><Check size={18} /></div>)}</div>
        </section>
        <section className="vt-closing"><ClinicDoodle kind="heart" className="vt-margin-heart" /><div><p className="vt-eyebrow">MEET YOUR CLINIC’S NEXT CHAPTER</p><h2>More connected work.<br />More considered care.</h2></div><div><Link className="vt-button" to="/create-account">Get started with Veterina <ArrowUpRight size={20} /></Link><p>Already have an account? <Link to="/sign-in">Sign in</Link></p></div></section>
      </main>
      <footer className="vt-footer"><img src="/brand/veterina-logo.png" alt="Veterina" width="150" height="50" /><p>Veterinary care, better connected.</p><span>© {new Date().getFullYear()} Veterina</span></footer>
    </div>
  )
}
