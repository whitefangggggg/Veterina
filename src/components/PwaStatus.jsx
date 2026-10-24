import { useEffect, useRef, useState } from 'react'
import { ArrowClockwise, DownloadSimple, WifiSlash } from '@phosphor-icons/react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Modal } from './ui'
import './PwaStatus.css'

function isInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
}

function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export default function PwaStatus() {
  const registration = useRef(null)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [installed, setInstalled] = useState(isInstalled)
  const [installPrompt, setInstallPrompt] = useState(null)
  const [installHelpOpen, setInstallHelpOpen] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [actionError, setActionError] = useState('')
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, worker) { registration.current = worker },
    onRegisterError(error) { console.error('Veterina offline setup failed:', error) },
  })

  useEffect(() => {
    const checkForUpdate = () => {
      if (navigator.onLine) void registration.current?.update().catch(() => {})
    }
    const onOnline = () => { setOnline(true); checkForUpdate() }
    const onOffline = () => setOnline(false)
    const onInstallPrompt = (event) => { event.preventDefault(); setInstallPrompt(event) }
    const onInstalled = () => { setInstalled(true); setInstallPrompt(null) }
    const displayMode = window.matchMedia('(display-mode: standalone)')
    const onDisplayMode = () => setInstalled(isInstalled())
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    window.addEventListener('beforeinstallprompt', onInstallPrompt)
    window.addEventListener('appinstalled', onInstalled)
    window.addEventListener('focus', checkForUpdate)
    displayMode.addEventListener('change', onDisplayMode)
    const interval = window.setInterval(checkForUpdate, 60 * 60 * 1000)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('beforeinstallprompt', onInstallPrompt)
      window.removeEventListener('appinstalled', onInstalled)
      window.removeEventListener('focus', checkForUpdate)
      displayMode.removeEventListener('change', onDisplayMode)
      window.clearInterval(interval)
    }
  }, [])

  const install = async () => {
    setActionError('')
    if (!installPrompt) { setInstallHelpOpen(true); return }
    setInstalling(true)
    try {
      await installPrompt.prompt()
      const { outcome } = await installPrompt.userChoice
      if (outcome === 'accepted') setInstalled(true)
    } catch {
      setActionError('Use your browser menu to install Veterina or add it to your home screen.')
      setInstallHelpOpen(true)
    } finally {
      setInstallPrompt(null)
      setInstalling(false)
    }
  }

  const update = async () => {
    setUpdating(true)
    setActionError('')
    try { await updateServiceWorker(true) }
    catch { setActionError('The update could not be applied. Please try again.') }
    finally { setUpdating(false) }
  }

  const installInstructions = !window.isSecureContext
    ? 'Open Veterina over HTTPS, then choose Install Veterina again.'
    : isIos()
      ? 'In Safari, open Share, then choose Add to Home Screen and Open as Web App. If you are using another browser, open this page in Safari first.'
      : 'Open your browser menu and choose Install Veterina, Install this page as an app, or Add to Home Screen. If no installation option appears, open Veterina in Chrome or Edge in a regular browsing window.'

  return (
    <>
    <aside className="pwa-status" aria-label="Veterina app status">
      {!online && <div className="pwa-notice pwa-offline" role="status">
        <WifiSlash size={22} aria-hidden="true" />
        <div><strong>You're offline</strong><p>Clinic records and saves need an internet connection. Keep this page open to retain unsaved entries.</p></div>
      </div>}
      {needRefresh && <section className="pwa-notice" aria-label="App update available">
        <ArrowClockwise size={22} aria-hidden="true" />
        <div><strong>A Veterina update is ready</strong><p>Save your work in all Veterina tabs before reloading.</p>
          <div className="pwa-actions">
            <button type="button" className="button button-primary" onClick={update} disabled={updating || !online}>{updating ? 'Updating…' : 'Reload and update'}</button>
            <button type="button" className="button button-secondary" onClick={() => { setNeedRefresh(false); setActionError('') }} disabled={updating}>Later</button>
          </div>
        </div>
      </section>}
      {!installed && <button type="button" className="button button-primary pwa-install-button" onClick={install} disabled={installing || !online} aria-haspopup={installPrompt ? undefined : 'dialog'}>
        <DownloadSimple size={20} aria-hidden="true" />{installing ? 'Installing…' : 'Install Veterina'}
      </button>}
      {actionError && <p className="pwa-notice pwa-action-error" role="alert">{actionError}</p>}
    </aside>
    {installHelpOpen && !installed && <Modal title="Install Veterina" description="Keep the clinic app on your home screen or desktop." onClose={() => setInstallHelpOpen(false)}>
      <p className="pwa-install-instructions">{installInstructions}</p>
      <div className="pwa-actions"><button type="button" className="button button-primary" onClick={() => setInstallHelpOpen(false)}>Done</button></div>
    </Modal>}
    </>
  )
}
