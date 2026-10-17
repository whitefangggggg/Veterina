import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ClinicDataProvider } from '../context/ClinicDataContext'
import { safeReturnTo } from '../lib/authAccess'
import AppShell from './AppShell'
import { AuthAccessError, AuthLoading } from './AuthStatus'

export default function ProtectedWorkspace() {
  const { access, user } = useAuth()
  const location = useLocation()
  const returnTo = safeReturnTo(`${location.pathname}${location.search}${location.hash}`)
  if (access === 'loading') return <AuthLoading />
  if (access === 'error') return <AuthAccessError />
  if (access === 'signed-out') return <Navigate to={`/sign-in?next=${encodeURIComponent(returnTo)}`} replace />
  if (access !== 'approved') return <Navigate to={`/access-pending?next=${encodeURIComponent(returnTo)}`} replace />
  return <ClinicDataProvider key={user.id}><AppShell /></ClinicDataProvider>
}
