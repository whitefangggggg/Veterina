import { lazy, Suspense, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useClinicData } from '../context/ClinicDataContext'
import { safeReturnTo } from '../lib/authAccess'

const ClinicOnboarding = lazy(() => import('../pages/ClinicOnboarding'))

export default function OwnerOnboardingGate({ children }) {
  const { profile } = useAuth()
  const { settings, reload } = useClinicData()
  const location = useLocation()
  const navigate = useNavigate()
  const [completedHere, setCompletedHere] = useState(false)
  const revisiting = location.pathname === '/clinic-setup'
  if (profile.role !== 'owner') return revisiting ? <Navigate to="/dashboard" replace /> : children
  if (!revisiting && (completedHere || settings?.onboarding_completed_at !== null)) return children
  return <Suspense fallback={<div className="page-loader" role="status">Preparing your clinic setup...</div>}>
    <ClinicOnboarding key={settings?.clinic_id || profile.clinic_id || profile.id} revisiting={revisiting} onFinished={async () => {
      await reload()
      setCompletedHere(true)
      if (revisiting) navigate(safeReturnTo(new URLSearchParams(location.search).get('next') || '/settings'), { replace: true })
    }} />
  </Suspense>
}
