import { useSyncExternalStore } from 'react'
import './DoctorDino.css'

const motionQuery = () => window.matchMedia('(prefers-reduced-motion: reduce)')
const subscribeToMotion = (notify) => {
  const query = motionQuery()
  query.addEventListener('change', notify)
  return () => query.removeEventListener('change', notify)
}
const getReducedMotion = () => motionQuery().matches

/** Pixel mascot with an explicit play override for reduced-motion visitors. */
export default function DoctorDino() {
  const reducedMotion = useSyncExternalStore(subscribeToMotion, getReducedMotion, () => false)
  const playing = !reducedMotion
  return (
    <div className={`vt-dino-lane${playing ? ' is-playing' : ''}`}>
      <div className="vt-dino-track" aria-hidden="true">
        <div className="vt-dino-traveller"><div className="vt-dino-facing">
          <svg className="vt-doctor-dino" viewBox="0 0 48 48" shapeRendering="crispEdges" aria-hidden="true">
            <g className="vt-dino-bob">
              {/* Tail and upright T-rex silhouette, built on a square pixel grid. */}
              <path d="M4 24h3v5h4v4h8v-6h4V12h3V8h16v3h3v11H33v4h5v3h4v4h-3v-2h-5v9H17v-3h-6v-4H7v-4H4Z" fill="#c5dfa8" />
              <path d="M29 12h3v3h-3Z" fill="#204c43" />
              <path d="M36 19h9v3H35v-2h-3v-2h4Z" fill="#204c43" />
              <path d="M39 19h3v1h-3Z" fill="#f5f7e9" />
              {/* White clinic coat, lapels, pocket, and tiny stethoscope. */}
              <path d="M23 25h5v3h6v6h3v7H18v-7h3v-6h2Z" fill="#f5f7e9" />
              <path d="M25 25h2v5h3v-2h3v3h-3v9h-2v-8h-3Z" fill="#7fa99a" />
              <path d="M23 29h1v4h2v1h-4v-5h1Zm9 6h3v3h-3Z" fill="#2a6f62" />
              <path d="M33 35h2v1h-2Z" fill="#efd787" />
              <path d="M34 28h4v2h3v3h-3v-2h-4Z" fill="#f5f7e9" />
              {/* Doctor's cap with a teal cross. */}
              <path d="M27 4h13v5H26V6h1Z" fill="#f5f7e9" />
              <path d="M32 5h2v1h1v1h-1v1h-2V7h-1V6h1Z" fill="#2a6f62" />
            </g>
            <g className="vt-dino-legs-a" fill="#c5dfa8"><path d="M21 40h4v5h4v2h-8Zm9 0h4v3h4v2h-6v-2h-2Z" /></g>
            <g className="vt-dino-legs-b" fill="#c5dfa8"><path d="M21 40h4v3h-3v2h-5v-2h4Zm9 0h4v5h4v2h-8Z" /></g>
          </svg>
        </div></div>
      </div>
    </div>
  )
}
