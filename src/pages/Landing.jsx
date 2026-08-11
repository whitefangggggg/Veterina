import { Link } from 'react-router-dom'
import {
  BellRinging,
  CalendarBlank,
  Cat,
  ClipboardText,
  Dog,
  EnvelopeSimple,
  Heart,
  MagnifyingGlass,
  Package,
  PawPrint,
  Phone,
  Rabbit,
  SquaresFour,
  Stethoscope,
  Syringe,
  DeviceTabletSpeaker,
} from '@phosphor-icons/react'

const FEATURES = [
  {
    icon: PawPrint,
    title: 'Digital pet records',
    copy: 'Pets, owners, health alerts, and details kept together.',
    tone: 'mint',
  },
  {
    icon: ClipboardText,
    title: 'Clinical history',
    copy: 'Checkups, vitals, notes, and care plans—clearly logged.',
    tone: 'sky',
  },
  {
    icon: Syringe,
    title: 'Vaccinations',
    copy: 'Log doses, next-due dates, and follow-up reminders.',
    tone: 'amber',
  },
  {
    icon: CalendarBlank,
    title: 'Appointments',
    copy: 'A calm month view with a focused daily agenda.',
    tone: 'violet',
  },
  {
    icon: BellRinging,
    title: 'Reminders',
    copy: 'Follow-up calls, vaccine due dates, and outcomes.',
    tone: 'green',
  },
  {
    icon: Package,
    title: 'Stock & suppliers',
    copy: 'Quantities, expiries, movement updates, and contacts.',
    tone: 'rose',
  },
]

const BENEFITS = [
  { icon: MagnifyingGlass, title: 'Find records fast', copy: 'Search pets and owners without digging through paper or folders.' },
  { icon: SquaresFour, title: 'Stay organized', copy: 'Appointments, reminders, and stock live in one calm workspace.' },
  { icon: Heart, title: 'Keep care connected', copy: 'Visits, vaccines, and follow-ups stay linked to each pet.' },
  { icon: DeviceTabletSpeaker, title: 'Tablet-first comfort', copy: 'Built for clinic floors—comfortable on tablet and phone.' },
]

export default function Landing() {
  return (
    <div className="landing">
      {/* Marketing-safe root. Future clinic workspaces can live under /:clinicSlug or /app/:clinicSlug. */}
      <header className="landing-header">
        <div className="landing-header-inner">
          <a href="#top" className="landing-brand">
            <span className="landing-brand-mark" aria-hidden>
              <Stethoscope weight="bold" />
            </span>
            <span>
              <strong>Veterina</strong>
              <small>Clinic care system</small>
            </span>
          </a>
          <nav className="landing-nav" aria-label="Page">
            <a href="#features">Features</a>
            <a href="#why">Why clinics</a>
            <a href="#contact">Contact</a>
          </nav>
          <Link to="/dashboard" className="landing-btn landing-btn-primary landing-header-cta">
            Try the demo
          </Link>
        </div>
      </header>

      <main id="top">
        <section className="landing-hero">
          <div className="landing-hero-bg" aria-hidden />
          <div className="landing-hero-inner">
            <div className="landing-hero-copy">
              <p className="landing-kicker">
                <Heart weight="fill" aria-hidden />
                <span className="landing-kicker-rule" />
                Thoughtful care, better organized
              </p>
              <h1>
                More time for <em>wagging tails.</em>
              </h1>
              <p className="landing-lead">
                Patient care, appointments, reminders, stock, and clinic records in one calm workspace for every busy clinic day.
              </p>
              <div className="landing-hero-actions">
                <Link to="/dashboard" className="landing-btn landing-btn-primary">
                  Try the demo
                </Link>
                <a href="#contact" className="landing-btn landing-btn-ghost">
                  Talk to us
                </a>
              </div>
            </div>
            <div className="landing-hero-visual" aria-hidden="true">
              <div className="landing-hero-device">
                <div className="landing-hero-device-bar">
                  <span /><span /><span />
                  <p>Veterina · Today</p>
                </div>
                <div className="landing-hero-device-body">
                  <div className="landing-hero-panel">
                    <header>
                      <p>Patients</p>
                      <small>3 in clinic</small>
                    </header>
                    <ul>
                      <li>
                        <span className="landing-hero-avatar" style={{ '--tone': '#78a99a' }}><Dog weight="duotone" /></span>
                        <div>
                          <strong>Bella</strong>
                          <span>Golden Retriever · Exam room 1</span>
                        </div>
                        <em>Active</em>
                      </li>
                      <li>
                        <span className="landing-hero-avatar" style={{ '--tone': '#8aa7c4' }}><Cat weight="duotone" /></span>
                        <div>
                          <strong>Mochi</strong>
                          <span>Domestic Shorthair · Vaccine due</span>
                        </div>
                        <em className="warn">Due</em>
                      </li>
                      <li>
                        <span className="landing-hero-avatar" style={{ '--tone': '#c4a57a' }}><Rabbit weight="duotone" /></span>
                        <div>
                          <strong>Coco</strong>
                          <span>Holland Lop · Follow-up</span>
                        </div>
                        <em>Booked</em>
                      </li>
                    </ul>
                  </div>
                  <div className="landing-hero-panel landing-hero-panel-agenda">
                    <header>
                      <p>Agenda</p>
                      <small>Thu</small>
                    </header>
                    <ul>
                      <li><time>09:00</time><div><strong>Wellness checkup</strong><span>Bella</span></div></li>
                      <li><time>11:30</time><div><strong>Vaccination</strong><span>Mochi</span></div></li>
                      <li><time>14:15</time><div><strong>Post-op review</strong><span>Coco</span></div></li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-section" id="features">
          <div className="landing-section-inner">
            <header className="landing-section-head">
              <p className="landing-eyebrow">One connected clinic workspace</p>
              <h2>Everything your day needs, in its place.</h2>
              <p>Only the tools clinics use every day—clear, calm, and ready when you are.</p>
            </header>
            <ul className="landing-features">
              {FEATURES.map(({ icon: Icon, title, copy, tone }) => (
                <li key={title} className={`landing-feature tone-${tone}`}>
                  <span className="landing-feature-icon" aria-hidden>
                    <Icon weight="duotone" />
                  </span>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="landing-section landing-why" id="why">
          <div className="landing-section-inner">
            <header className="landing-section-head landing-section-head-light">
              <p className="landing-eyebrow">Why clinics love it</p>
              <h2>A better flow for every kind of busy.</h2>
              <p>Less searching, less switching, more focus on the animals in front of you.</p>
            </header>
            <ul className="landing-benefits">
              {BENEFITS.map(({ icon: Icon, title, copy }) => (
                <li key={title}>
                  <span aria-hidden>
                    <Icon weight="duotone" />
                  </span>
                  <div>
                    <h3>{title}</h3>
                    <p>{copy}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="landing-section" id="preview" aria-labelledby="preview-title">
          <div className="landing-section-inner">
            <header className="landing-section-head">
              <p className="landing-eyebrow">Product preview</p>
              <h2 id="preview-title">A quieter way to run the day.</h2>
              <p>Lightweight peeks at patients and appointments—the same calm tone as the clinic app.</p>
            </header>
            <div className="landing-preview">
              <article className="landing-mock" aria-hidden>
                <div className="landing-mock-chrome">
                  <span /><span /><span />
                  <p>Patients</p>
                </div>
                <div className="landing-mock-body">
                  <div className="landing-mock-row">
                    <strong>Bella</strong>
                    <span>Golden Retriever · Active</span>
                  </div>
                  <div className="landing-mock-row">
                    <strong>Mochi</strong>
                    <span>Domestic Shorthair · Vaccine due</span>
                  </div>
                  <div className="landing-mock-row">
                    <strong>Coco</strong>
                    <span>Holland Lop · Follow-up</span>
                  </div>
                </div>
              </article>
              <article className="landing-mock landing-mock-agenda" aria-hidden>
                <div className="landing-mock-chrome">
                  <span /><span /><span />
                  <p>Today&apos;s agenda</p>
                </div>
                <div className="landing-mock-body">
                  <div className="landing-mock-appt">
                    <time>09:00</time>
                    <div>
                      <strong>Wellness checkup</strong>
                      <span>Bella · Exam room 1</span>
                    </div>
                  </div>
                  <div className="landing-mock-appt">
                    <time>11:30</time>
                    <div>
                      <strong>Vaccination</strong>
                      <span>Mochi · Front desk</span>
                    </div>
                  </div>
                  <div className="landing-mock-appt">
                    <time>14:15</time>
                    <div>
                      <strong>Post-op review</strong>
                      <span>Coco · Exam room 2</span>
                    </div>
                  </div>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section className="landing-cta" id="contact">
          <div className="landing-cta-inner">
            <p className="landing-eyebrow">Ready when you are</p>
            <h2>Bring calmer clinic days to your team.</h2>
            <p>Try the live demo, or reach out—we&apos;d love to hear how your clinic works.</p>
            <div className="landing-cta-actions">
              <Link to="/dashboard" className="landing-btn landing-btn-primary">
                Open the demo
              </Link>
              <div className="landing-contacts">
                <a href="mailto:ezekielwhitefang@gmail.com">
                  <EnvelopeSimple weight="bold" aria-hidden />
                  ezekielwhitefang@gmail.com
                </a>
                <a href="tel:+639760992209">
                  <Phone weight="bold" aria-hidden />
                  +63 976 099 2209
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="landing-brand landing-brand-sm">
            <span className="landing-brand-mark" aria-hidden>
              <Stethoscope weight="bold" />
            </span>
            <strong>Veterina</strong>
          </div>
          <p>Made for veterinary teams who care for every wag, purr, and chirp.</p>
        </div>
      </footer>
    </div>
  )
}
