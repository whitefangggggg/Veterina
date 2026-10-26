import { useEffect, useRef, useState } from 'react'
import { Modal } from './ui'
import { veterinaCodeFromQr } from '../lib/clinicAccess'

export default function ClinicQrScanner({ onCode, onClose }) {
  const video = useRef(null)
  const scanner = useRef(null)
  const liveSession = useRef(true)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [reading, setReading] = useState(false)
  const accept = (text) => {
    if (!liveSession.current) return
    const code = veterinaCodeFromQr(text, window.location.origin)
    if (!code) { setError('This is not a Veterina registration QR for this site. Try the QR provided by your shop owner.'); return }
    scanner.current?.destroy()
    onCode(code)
  }
  useEffect(() => {
    let alive = true
    liveSession.current = true
    let instance
    const element = video.current
    void (async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Camera scanning is unavailable here. Upload a QR image or enter the Veterina Code manually.')
      const { default: QrScanner } = await import('qr-scanner')
      if (!alive) return
      instance = new QrScanner(element, (result) => { if (alive) accept(result.data) }, { preferredCamera: 'environment', returnDetailedScanResult: true, maxScansPerSecond: 5, highlightScanRegion: true })
      scanner.current = instance
      await instance.start()
      if (!alive) { instance.destroy(); element.srcObject?.getTracks().forEach((track) => track.stop()); return }
      setReady(true)
    })().catch(() => { if (alive) setError('Camera access was denied or no camera is available. Upload a QR image or enter the code manually.') })
    return () => { alive = false; liveSession.current = false; instance?.destroy(); element?.srcObject?.getTracks().forEach((track) => track.stop()) }
    // The dialog keeps its callbacks for this scanner session; unmount stops it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const upload = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.size > 5000000) { setError('Choose a QR image smaller than 5 MB.'); return }
    setReading(true); setError('')
    try { const { default: QrScanner } = await import('qr-scanner'); const result = await QrScanner.scanImage(file, { returnDetailedScanResult: true }); accept(result.data) }
    catch { if (liveSession.current) setError('No readable registration QR was found. Try another image or enter the code manually.') }
    finally { if (liveSession.current) setReading(false) }
  }
  return <Modal title="Scan Veterina QR" description="Point your camera at the registration QR from your shop owner." onClose={onClose}>
    <video ref={video} className="clinic-qr-video" muted playsInline aria-label="QR camera preview" />
    {!ready && !error && <p role="status">Starting camera…</p>}
    {error && <p className="auth-message auth-error" role="alert">{error}</p>}
    <label className="field"><span>Or upload a QR image</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={reading} onChange={upload} /></label>
    <div className="form-actions"><button type="button" className="button button-secondary" onClick={onClose}>Enter code manually</button></div>
  </Modal>
}
