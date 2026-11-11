import { useSyncExternalStore } from 'react'
import './PixelPatients.css'

const subscribe = (notify) => {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)')
  query.addEventListener('change', notify)
  return () => query.removeEventListener('change', notify)
}
const snapshot = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
function PixelPatient({ children, className, label }) {
  const reducedMotion = useSyncExternalStore(subscribe, snapshot, () => false)
  const playing = !reducedMotion
  return <div className={`vt-pixel-patient ${className}${playing ? ' is-playing' : ''}`}>
    <div role="img" aria-label={label}>{children}</div>
  </div>
}

export function SleepingPatientCat() {
  return <PixelPatient className="vt-sleepy-cat" label="Sleeping pixel cat in a patient gown, curled up on a soft teal cat bed">
    <svg viewBox="0 0 88 48" shapeRendering="crispEdges" aria-hidden="true">
      {/* Raised sides, cushion, and feet of the little bed. */}
      <path d="M4 29h7v5h66v-5h7v14h-4v3H8v-3H4Z" fill="#447e70" />
      <path d="M11 32h66v8H11Z" fill="#a9d2bb" /><path d="M9 42h71v2H9Z" fill="#306053" />
      <g className="vt-cat-breathe">
        <path d="M30 18h33v3h7v7h3v7H25V24h5Z" fill="#f4ede0" />
        <path d="M37 19h22v3h6v13H32V23h5Z" fill="#d5e8df" />
        <path d="M42 23h2v2h-2Zm12 0h2v2h-2Zm-6 5h2v2h-2Z" fill="#6b9d8d" />
        <path d="M14 16h4v-5h3l6 7h6l5-7h3v20h-4v5H18v-4h-4Z" fill="#d9a778" />
        <path d="M18 16h3v4h-3Zm18 0h2v4h-2Z" fill="#edc6ad" />
        <path d="M18 26h3v2h5v-2h2v4H18Zm13 0h2v2h5v2h-7Z" fill="#69503e" />
        <path d="M27 31h3v2h-3Z" fill="#b37e66" />
        <path d="M62 26h8v3h6v6h-5v-3h-9v-2h-4v-4h4Z" fill="#d9a778" />
      </g>
      <g className="vt-cat-zzz" fill="#6c9482"><path d="M57 9h8v2l-5 4h5v2h-8v-2l5-4h-5Z" /><path d="M72 2h6v2l-3 3h3v2h-6V7l3-3h-3Z" /></g>
    </svg>
  </PixelPatient>
}

export function ExcitedPatientDog() {
  return <PixelPatient className="vt-excited-dog" label="Front-facing brown pixel dog inspired by the reference, with floppy dark ears, a cream muzzle and paws, long nails, and a medical coat">
    <svg viewBox="0 0 64 76" shapeRendering="crispEdges" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <g className="vt-patient-dog-bounce">
        {/* Tail sits behind the body; the face moves as a single rigid piece. */}
        <g className="vt-patient-dog-tail"><path d="M45 54h6V44h4V32h3v-8h-4v6h-3v10h-4v8h-2Z" fill="#9b6039" /><path d="M54 22h4v9h-4Z" fill="#c29560" /></g>
        <path d="M21 43h22v5h4v17H17V48h4Z" fill="#9b6039" />
        {/* White coat, teal lapels, stethoscope and pocket. */}
        <path d="M22 44h20v3h4v15H18V47h4Z" fill="#f1f3e6" />
        <path d="m25 44 5 5h4l5-5v5l-5 5v8h-4v-8l-5-5Z" fill="#88b6a4" />
        <path d="M22 48h2v6h3v-6h2v8h-7Zm15 7h6v5h-6Z" fill="#2a6f62" /><path d="M39 55h2v2h-2Z" fill="#e4c972" />
        {/* Cream paws and individual long nails. */}
        <path d="M17 59h10v8H15v-6h2Zm20 0h10v2h2v6H37Z" fill="#dfcda8" />
        <path d="M16 66h2v6h-2Zm4 0h2v7h-2Zm4 0h2v6h-2Zm14 0h2v6h-2Zm4 0h2v7h-2Zm4 0h2v6h-2Z" fill="#a99e88" />
        {/* Broad, forward-facing head with the reference's brown-and-cream markings. */}
        <path d="M23 14h18v3h5v5h3v15h-4v7H19v-7h-4V22h3v-5h5Z" fill="#a66b39" />
        <path d="M18 20h7v5h-3v14h-4v6h-6v-7H9V25h4v-5Zm21 0h7v3h5v4h4v11h-3v7h-6v-6h-4V25h-3Z" fill="#65412c" />
        <path d="M23 23h5v3h-5Zm13 0h5v3h-5Z" fill="#cc9654" />
        <path d="M21 27h8v8h-8Zm14 0h8v8h-8Z" fill="#4c3b2c" />
        <path d="M23 28h4v5h-4Zm14 0h4v5h-4Z" fill="#202c29" /><path d="M24 28h2v2h-2Zm14 0h2v2h-2Z" fill="#fff9ec" />
        <path d="M30 29h4v6h-4Z" fill="#f0e5ca" />
        <path d="M25 34h14v3h4v7h-5v4H26v-4h-5v-7h4Z" fill="#dfcda8" />
        <path d="M28 35h8v4h-2v2h-4v-2h-2Z" fill="#29302b" />
        <path d="M27 42h10v4H27Z" fill="#563d31" /><path d="M29 44h6v7h-2v2h-2v-2h-2Z" fill="#d98f91" />
        {/* Small medical cap leaves both ears visible. */}
        <path d="M24 8h16v8H22v-6h2Z" fill="#f1f3e6" /><path d="M30 9h3v2h2v2h-2v2h-3v-2h-2v-2h2Z" fill="#2a6f62" />
      </g>
      <g className="vt-dog-excitement" fill="#c7a34d"><path d="M9 10h2v6H9Zm44 1h2v6h-2ZM3 18h5v2H3Zm53 2h5v2h-5Z" /></g>
    </svg>
  </PixelPatient>
}
