import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from 'react-router-dom'
import ProtectedWorkspace from './components/ProtectedWorkspace'
import { useAuth } from './context/AuthContext'
import { safeAuthReturnTo } from './lib/authAccess'
import { NotFoundView, RouteErrorView } from './components/ErrorViews'

const Landing = lazy(() => import('./pages/Landing'))
const Auth = lazy(() => import('./pages/Auth'))
const PasswordRecovery = lazy(() => import('./pages/PasswordRecovery'))
const AccessPending = lazy(() => import('./pages/AccessPending'))
const CompleteAccount = lazy(() => import('./pages/CompleteAccount'))
const PlatformAdmin = lazy(() => import('./pages/PlatformAdmin'))
const Subscription = lazy(() => import('./pages/Subscription'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Queue = lazy(() => import('./pages/Queue'))
const Admissions = lazy(() => import('./pages/Admissions'))
const AdmissionDetail = lazy(() => import('./pages/AdmissionDetail'))
const Patients = lazy(() => import('./pages/Patients'))
const PetDetail = lazy(() => import('./pages/PetDetail'))
const TravelCertificates = lazy(() => import('./pages/TravelCertificates'))
const PublicTravelCertificate = lazy(() => import('./pages/PublicTravelCertificate'))
const Appointments = lazy(() => import('./pages/Operations').then((module) => ({ default: module.Appointments })))
const Inventory = lazy(() => import('./pages/Stock').then((module) => ({ default: module.Inventory })))
const Suppliers = lazy(() => import('./pages/Stock').then((module) => ({ default: module.Suppliers })))
const Reports = lazy(() => import('./pages/Admin').then((module) => ({ default: module.Reports })))
const Settings = lazy(() => import('./pages/Admin').then((module) => ({ default: module.Settings })))
// Knowledge workspace is paused; retain its implementation for a later release.
// const Knowledge = lazy(() => import('./pages/Knowledge'))
const Login = lazy(() => import('./pages/Login'))

function PageLoader({ children }) {
  return <Suspense fallback={<div className="page-loader"><span /><p>Loading Veterina...</p></div>}>{children}</Suspense>
}

const load = (element) => <PageLoader>{element}</PageLoader>

function RecoveryRedirect() {
  const { recoveringPassword } = useAuth()
  const location = useLocation()
  if (recoveringPassword && !['/reset-password', '/forgot-password'].includes(location.pathname)) {
    const requested = new URLSearchParams(location.search).get('next')
    const next = safeAuthReturnTo(requested || `${location.pathname}${location.search}`)
    return <Navigate to={`/reset-password?next=${encodeURIComponent(next)}`} replace />
  }
  return <Outlet />
}

function LegacyReminderRedirect() {
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  params.set('view', 'tasks')
  return <Navigate to={{ pathname: '/appointments', search: `?${params}`, hash: location.hash }} replace />
}

const router = createBrowserRouter([{ element: <RecoveryRedirect />, errorElement: <RouteErrorView />, children: [
  // Marketing-safe paths (/). Clinic workspaces can later live under /:clinicSlug or /app/:clinicSlug.
  {
    path: '/',
    element: load(<Landing />),
  },
  { path: '/sign-in', element: load(<Auth key="sign-in" />) },
  { path: '/travel-certificate', element: load(<PublicTravelCertificate />) },
  { path: '/admin/sign-in', element: load(<Auth key="admin-sign-in" mode="admin" />) },
  { path: '/admin', element: load(<PlatformAdmin />) },
  { path: '/subscription', element: load(<Subscription />) },
  { path: '/create-account', element: load(<Auth key="create-account" mode="create-account" />) },
  { path: '/forgot-password', element: load(<PasswordRecovery key="forgot-password" />) },
  { path: '/reset-password', element: load(<PasswordRecovery key="reset-password" mode="reset" />) },
  { path: '/access-pending', element: load(<AccessPending />) },
  { path: '/complete-account', element: load(<CompleteAccount />) },
  { path: '/login', element: load(<Login />) },
  { path: '/demo', element: load(<Login />) },
  {
    element: <ProtectedWorkspace />,
    children: [
      { path: '/dashboard', element: load(<Dashboard />) },
      { path: '/queue', element: load(<Queue />) },
      { path: '/admissions', element: load(<Admissions />) },
      { path: '/admissions/:admissionId', element: load(<AdmissionDetail />) },
      { path: '/patients', element: load(<Patients />) },
      { path: '/patients/:petId', element: load(<PetDetail />) },
      { path: '/travel-certificates', element: load(<TravelCertificates />) },
      { path: '/appointments', element: load(<Appointments />) },
      { path: '/reminders', element: <LegacyReminderRedirect /> },
      { path: '/inventory', element: load(<Inventory />) },
      { path: '/suppliers', element: load(<Suppliers />) },
      { path: '/reports', element: load(<Reports />) },
      { path: '/settings', element: load(<Settings />) },
      { path: '/clinic-setup', element: <Navigate to="/settings" replace /> },
      // { path: '/knowledge', element: load(<Knowledge />) },
    ],
  },
  { path: '*', element: <NotFoundView /> },
]}])

export default function App() {
  return <RouterProvider router={router} />
}
