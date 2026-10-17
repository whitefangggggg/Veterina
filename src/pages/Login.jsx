import { Navigate, useLocation } from 'react-router-dom'
import { requiresPasswordSetup } from '../lib/supabaseClient'

// Preserve existing links and invitation callbacks with the approved account flow.
export default function Login() {
  const location = useLocation()
  const path = requiresPasswordSetup ? '/reset-password' : '/sign-in'
  return <Navigate to={`${path}${location.search}${location.hash}`} replace />
}
