import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Printer } from '@phosphor-icons/react'
import { fetchPublicTravelCertificate } from '../lib/travelCertificateRepository'
import { printTravelCertificate, travelCertificateHtml } from '../lib/travelCertificates'
import './PublicTravelCertificate.css'

export default function PublicTravelCertificate() {
  const token = useLocation().hash.slice(1)
  const [result, setResult] = useState({ status: 'loading', certificate: null })
  const [retry, setRetry] = useState(0)
  const [printing, setPrinting] = useState(false)
  const [printError, setPrintError] = useState('')
  useEffect(() => {
    const tags = [['robots', 'noindex, nofollow, noarchive'], ['referrer', 'no-referrer']].map(([name, content]) => {
      const element = document.createElement('meta'); element.name = name; element.content = content; document.head.appendChild(element); return element
    })
    return () => tags.forEach((element) => element.remove())
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    let generation = 0
    setResult({ status: 'loading', certificate: null }); setPrintError('')
    const load = async () => {
      const current = ++generation
      try {
        const certificate = await fetchPublicTravelCertificate(token, controller.signal)
        if (!controller.signal.aborted && current === generation) setResult({ status: certificate ? 'ready' : 'unavailable', certificate })
      } catch {
        if (!controller.signal.aborted && current === generation) setResult({ status: 'error', certificate: null })
      }
    }
    void load()
    window.addEventListener('focus', load)
    const interval = setInterval(load, 30000)
    return () => { controller.abort(); clearInterval(interval); window.removeEventListener('focus', load) }
  }, [token, retry])
  const certificate = result.certificate
  return <main className="public-travel-certificate">
    <header className="public-certificate-header"><div><span className="eyebrow">Clinic-issued document</span><h1>{result.status === 'unavailable' ? 'Certificate not available' : 'Pet Travel Certificate'}</h1>{certificate && <p>{certificate.reference_number} · {certificate.status === 'void' ? 'Void certificate' : 'Public certificate'}</p>}</div>
      {certificate && <button className="button button-primary" disabled={printing} onClick={async () => {
        setPrinting(true); setPrintError('')
        try {
          const latest = await fetchPublicTravelCertificate(token)
          if (!latest) { setResult({ status: 'unavailable', certificate: null }); return }
          setResult({ status: 'ready', certificate: latest }); await printTravelCertificate(latest)
        } catch { setPrintError('The certificate could not be prepared for printing. Please retry Print / PDF.') }
        finally { setPrinting(false) }
      }}><Printer size={18} />{printing ? 'Preparing...' : 'Print / PDF'}</button>}
    </header>
    {result.status === 'loading' && <p role="status">Loading certificate…</p>}
    {result.status === 'unavailable' && <div className="public-certificate-message"><p>This certificate is private or unavailable. Contact the issuing clinic for access.</p><Link className="text-link" to="/sign-in">Clinic staff sign in</Link></div>}
    {result.status === 'error' && <div className="public-certificate-message"><p role="alert">The certificate could not be loaded. Please try again.</p><button className="button button-secondary" onClick={() => setRetry((value) => value + 1)}>Retry loading certificate</button></div>}
    {printError && <p className="auth-message auth-error" role="alert">{printError}</p>}
    {certificate && <iframe title="Public travel certificate" sandbox="" className="public-certificate-document" srcDoc={travelCertificateHtml(certificate)} />}
  </main>
}
