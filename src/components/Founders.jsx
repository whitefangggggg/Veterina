import { useState, useSyncExternalStore } from 'react'
import { ArrowUpRight } from '@phosphor-icons/react'
import './Founders.css'

const founders = [
  { name: 'Ezekiel Gil T. Saludsod', role: 'CEO', title: 'Chief Executive Officer', initials: 'ES', type: 'white', line: 'Big ideas. Thoughtful systems.', bio: 'A full-stack developer and automation engineer building GenAI applications at EY GDS Philippines. From live booking platforms to award-winning projects like ResKiosk and Linea, Ezekiel brings hands-on product building to Veterina.', tags: ['Product & automation', 'Full-stack development'] },
  { name: 'Aldrin John A. Vitorillo', role: 'CTO', title: 'Chief Technology Officer', initials: 'AV', type: 'fluffy', line: 'Curiosity, turned into working tools.', bio: 'A full-stack developer focused on applied AI, voice systems, and workflow automation. Aldrin has delivered platforms for investors and editorial teams, and co-built Veterina to connect the many moving parts of clinic work.', tags: ['Engineering & applied AI', 'Workflow automation'] },
  { name: 'Keziah Grace C. Canonigo', role: 'COO', title: 'Chief Operating Officer', initials: 'KC', type: 'short', line: 'Every paw. Every scale. All heart.', bio: 'A fourth-year Veterinary Medicine student at VSU, Keziah has helped handle a veterinary clinic since 2021, starting as a high school student during the pandemic. After helping hundreds of customers, she brings that everyday clinic experience—and her enthusiasm for every paw, scale, and feather—to Veterina.', tags: ['Clinic operations', 'Veterinary medicine student'] },
]

function PixelPup({ type }) {
  const white = type === 'white', short = type === 'short'
  const fur = white ? '#eeeae0' : short ? '#b98a52' : '#a86a34'
  const ears = white ? '#606b6c' : '#493a2d'
  return <svg className={`vt-founder-sprite vt-founder-sprite--${type}`} viewBox="0 0 64 72" shapeRendering="crispEdges" aria-hidden="true">
    <path d="M12 66h40v3H12Z" fill="#1d554b" opacity=".12" />
    <g className="vt-pup-body">
    <path className="vt-pup-tail" d="M43 44h8V29h4V19h-4v6h-4v10h-4Z" fill={fur} />
    <path d="M23 33h20v8h5v20H17V43h6Z" fill={fur} />
    <path d="M26 40h13v5h4v14H22V46h4Z" fill={white ? '#faf7ef' : '#eadcc1'} />
    <path d="M18 56h10v10H15v-7h3Zm19 0h10v3h3v7H37Z" fill={white ? '#e1ded2' : '#c7b38c'} />
    <path d={type === 'fluffy' ? 'M18 62h2v7h-2Zm5 0h2v9h-2Zm16 0h2v9h-2Zm5 0h2v7h-2Z' : 'M19 62h2v4h-2Zm5 0h2v4h-2Zm15 0h2v4h-2Zm5 0h2v4h-2Z'} fill="#978875" />
    <g className="vt-pup-head">
    <path d={short ? 'M23 10h17v3h5v6h3v16h-5v7H22v-5h-5V18h6Z' : 'M22 9h20v3h6v5h4v19h-4v6h-6v4H22v-4h-6v-6h-4V17h4v-5h6Z'} fill={fur} />
    <path d={short ? 'M17 12h10v5h-4v7h-5v-4h-4v-6h3Zm23-2h9v3h4v6h-4v4h-5v-8h-4Z' : 'M14 17h8v7h-3v15h-4v5H9v-7H6V23h4v-6Zm29 0h8v6h5v14h-3v7h-6v-5h-4Z'} fill={ears} />
    {!short && <path d="M22 12h5v8h-5Zm8-3h5v10h-5Zm9 3h5v8h-5ZM12 26h3v12h-3Zm37 0h3v12h-3Z" fill={white ? '#fffdf4' : '#c08a4e'} />}
    <path d="M21 24h8v9h-8Zm15 0h8v9h-8Z" fill={white ? '#b89b7a' : '#554232'} />
    <g className="vt-pup-eyes"><path d="M23 26h5v5h-5Zm14 0h5v5h-5Z" fill="#202d2a" /><path d="M24 26h2v2h-2Zm14 0h2v2h-2Z" fill="#fffdf5" /></g>
    <path d="M25 32h15v3h4v6h-5v4H26v-4h-5v-6h4Z" fill={short ? '#4e4c3f' : '#e3d4ba'} />
    {!short && <path d="M30 27h4v10h-4Z" fill="#f7f4e9" />}
    <path d="M28 34h9v4h-3v2h-3v-2h-3Z" fill="#202d2a" />
    <path d="M28 41h10v4H28Z" fill="#382f29" />
    {!white && <path d="M30 43h6v6h-2v2h-2v-2h-2Z" fill="#e5a0a0" />}
    </g>
    <path d="M22 47h7v3h10v-3h5v6H22Z" fill="#2a6f62" /><path d="M30 51h6v5h-6Z" fill="#e7c978" />
    </g>
  </svg>
}

function FounderAmbience({ veterinary }) {
  return <span className={`vt-founder-ambience ${veterinary ? 'is-vet' : 'is-tech'}`} aria-hidden="true">
    <svg viewBox="0 0 320 360" fill="none">
      {veterinary ? <>
        <g stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M25 83v-9h9V63h10v11h9v9h-9v10H34V83Z" />
          <path d="M255 56c-12-17-29-1-15 12l15 14 15-14c14-13-3-29-15-12Z" />
          <path d="M263 200v22c0 23 31 23 31 0v-17m-31-5h-5v-12m36 17h5v-12m-21 47v13c0 18-24 18-24 2v-12" />
          <circle cx="254" cy="247" r="6" />
          <path d="M28 266c-9-10-14 1-7 7l19 18c7 7 16-2 8-8l-19-18Zm6-8c-4-9-15-3-11 4m25 16c10 4 5 15-2 10" />
        </g>
        <g fill="currentColor" transform="translate(29 155) rotate(-18)">
          <ellipse cx="0" cy="0" rx="5" ry="7"/><ellipse cx="13" cy="-5" rx="5" ry="7"/><ellipse cx="25" cy="0" rx="5" ry="7"/><path d="M3 16c0-14 21-14 21 0 0 10-10 4-10 4S3 26 3 16Z"/>
        </g>
        <path d="M240 314h17l5-10 8 18 7-10h20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </> : <>
        <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m40 74-12 12 12 12m25-24 12 12-12 12m-8-29-8 34" />
          <rect x="240" y="49" width="54" height="39" rx="5"/><path d="m249 61 6 6-6 6m14 0h12M253 96h27m-14-8v8" />
          <path d="M14 182h27v22h20m-20-22v-23h14M290 153h-22v28h-15m15 0v23h22" />
          <circle cx="14" cy="182" r="3"/><circle cx="61" cy="204" r="3"/><circle cx="55" cy="159" r="3"/><circle cx="290" cy="153" r="3"/><circle cx="253" cy="181" r="3"/><circle cx="290" cy="204" r="3"/>
          <rect x="25" y="267" width="32" height="26" rx="3"/><path d="M32 267v-6m9 6v-6m9 6v-6m-18 32v6m9-6v6m9-6v6m-25-22h-6m6 9h-6m38-9h6m-6 9h6"/>
          <path d="M271 266h-8v12l-6 5 6 5v12h8m12-34h8v12l6 5-6 5v12h-8" />
        </g>
        <g fill="currentColor"><path d="M91 40h4v4h-4Zm111 266h4v4h-4ZM83 242h4v4h-4ZM219 131h4v4h-4Z"/></g>
      </>}
    </svg>
  </span>
}

function FounderCard({ founder: f, index }) {
  const [pinned, setPinned] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const open = pinned || hovered || focused
  return <article className={`vt-founder${open ? ' is-revealed' : ''}`}>
    <button className="vt-founder-avatar" onPointerEnter={e => { if (e.pointerType === 'mouse') setHovered(true) }} onPointerLeave={() => setHovered(false)} onFocus={e => setFocused(e.target.matches(':focus-visible'))} onBlur={() => setFocused(false)} onClick={() => setPinned(!pinned)} onKeyDown={e => { if (e.key === 'Escape') { setPinned(false); setFocused(false); setHovered(false) } }} aria-expanded={open} aria-controls={`founder-${index}`} aria-label={`Meet ${f.name}, ${f.role}`}>
      <span className="vt-founder-flipper">
        <span className="vt-founder-face vt-founder-front" aria-hidden={open}>
          <FounderAmbience veterinary={f.type === 'short'} />
          <span className="vt-founder-number">0{index + 1} / THE FOUNDING PACK <span className="vt-founder-role-title" title={f.title}>{f.role}</span></span>
          <span className="vt-founder-pet"><PixelPup type={f.type} /></span>
          <span className="vt-founder-front-line">{f.line}</span>
          <span className="vt-founder-hint">A little paws. A lot of purpose.<ArrowUpRight size={18} /></span>
        </span>
        <span className="vt-founder-face vt-founder-back" id={`founder-${index}`} aria-hidden={!open}>
          <span className="vt-founder-number">MEET THE HUMAN <span className="vt-founder-role-title" title={f.title}>{f.role}</span></span>
          <span className="vt-founder-monogram">{f.initials}<span>Co-founder / {f.role}</span></span>
          <strong className="vt-founder-back-name">{f.name}</strong>
          <span className="vt-founder-bio">{f.bio}</span>
          <span className="vt-founder-tags">{f.tags.map(tag => <span key={tag}>{tag}</span>)}</span>
          <span className="vt-founder-hint">People behind better-connected care.<ArrowUpRight size={18} /></span>
        </span>
      </span>
    </button>
    <div className="vt-founder-caption"><span>{f.role} / CO-FOUNDER</span><h3>{f.name}</h3></div>
  </article>
}
const subscribeMotion = notify => {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)')
  query.addEventListener('change', notify)
  return () => query.removeEventListener('change', notify)
}
const getReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export default function Founders() {
  const reducedMotion = useSyncExternalStore(subscribeMotion, getReducedMotion, () => true)
  const [motionChoice, setMotionChoice] = useState(null)
  const playing = motionChoice ?? !reducedMotion
  return <section className={`vt-founders${playing ? ' pups-playing' : ''}`} id="founders" aria-labelledby="vt-founders-heading"><div className="vt-founders-heading"><div><p className="vt-eyebrow">THE PEOPLE BEHIND THE PAWS</p><h2 id="vt-founders-heading">Meet the Founders!</h2></div><p>Built by people who build systems.<br />Shaped by someone who knows clinic life.<br /><span>Hover, focus, or tap a pup to meet us.</span><button type="button" className="vt-pup-motion-toggle" aria-pressed={playing} onClick={() => setMotionChoice(!playing)}>{playing ? 'Pause pups' : 'Play pups'}</button></p></div><div className="vt-founders-grid">{founders.map((founder, index) => <FounderCard key={founder.role} founder={founder} index={index} />)}</div></section>
}
