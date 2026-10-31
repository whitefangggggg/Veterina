import { useState } from 'react'
import { DownloadSimple } from '@phosphor-icons/react'
import { downloadPrescriptionImage, printPrescription } from '../lib/prescriptions'

export default function PrescriptionActions({ context }) {
  const [downloading, setDownloading] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [error, setError] = useState('')
  const download = async () => {
    if (downloading) return
    setDownloading(true)
    setError('')
    try { await downloadPrescriptionImage(context) }
    catch { setError('The prescription image could not be downloaded. Please try again, or use Print prescription / PDF.') }
    finally { setDownloading(false) }
  }
  const print = async () => {
    if (printing) return
    setPrinting(true); setError('')
    try { await printPrescription(context) }
    catch { setError('The prescription could not be prepared for printing. Please try again.') }
    finally { setPrinting(false) }
  }
  return <div className="prescription-actions">
    <button type="button" className="text-link" disabled={printing} aria-busy={printing} onClick={print}>Print prescription / PDF</button>
    <button type="button" className="text-link" disabled={downloading} aria-busy={downloading} onClick={download}><DownloadSimple size={16} aria-hidden="true" />{downloading ? 'Preparing image…' : 'Download prescription photo (PNG)'}</button>
    {error && <p className="auth-message auth-error" role="alert">{error}</p>}
  </div>
}
