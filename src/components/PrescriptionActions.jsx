import { useState } from 'react'
import { DownloadSimple } from '@phosphor-icons/react'
import { downloadPrescriptionImage, printPrescription } from '../lib/prescriptions'

export default function PrescriptionActions({ context }) {
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')
  const download = async () => {
    if (downloading) return
    setDownloading(true)
    setError('')
    try { await downloadPrescriptionImage(context) }
    catch { setError('The prescription image could not be downloaded. Please try again, or use Print prescription / PDF.') }
    finally { setDownloading(false) }
  }
  return <div className="prescription-actions">
    <button type="button" className="text-link" onClick={() => printPrescription(context)}>Print prescription / PDF</button>
    <button type="button" className="text-link" disabled={downloading} aria-busy={downloading} onClick={download}><DownloadSimple size={16} aria-hidden="true" />{downloading ? 'Preparing image…' : 'Download prescription photo (PNG)'}</button>
    {error && <p className="auth-message auth-error" role="alert">{error}</p>}
  </div>
}
