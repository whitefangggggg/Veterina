import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import AppShell from './components/AppShell'

const Landing = lazy(() => import('./pages/Landing'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Patients = lazy(() => import('./pages/Patients'))
const PetDetail = lazy(() => import('./pages/PetDetail'))
const Appointments = lazy(() => import('./pages/Operations').then((module) => ({ default: module.Appointments })))
const Reminders = lazy(() => import('./pages/Operations').then((module) => ({ default: module.Reminders })))
const Inventory = lazy(() => import('./pages/Stock').then((module) => ({ default: module.Inventory })))
const Suppliers = lazy(() => import('./pages/Stock').then((module) => ({ default: module.Suppliers })))
const Reports = lazy(() => import('./pages/Admin').then((module) => ({ default: module.Reports })))
const Settings = lazy(() => import('./pages/Admin').then((module) => ({ default: module.Settings })))
const Login = lazy(() => import('./pages/Login'))
const DemoEntry = lazy(() => import('./pages/Login').then((module) => ({ default: module.DemoEntry })))
const Knowledge = lazy(() => import('./pages/Knowledge'))

function PageLoader({ children }) {
  return <Suspense fallback={<div className="page-loader"><span /><p>Loading clinic records...</p></div>}>{children}</Suspense>
}

const load = (element) => <PageLoader>{element}</PageLoader>

const router = createBrowserRouter([
  { path:'/login',element:load(<Login />) },
  { path:'/demo',element:load(<DemoEntry />) },
  // Marketing-safe paths (/). Clinic workspaces can later live under /:clinicSlug or /app/:clinicSlug.
  {
    path: '/',
    element: load(<Landing />),
  },
  {
    element: <AppShell />,
    children: [
      { path: '/dashboard', element: load(<Dashboard />) },
      { path: '/patients', element: load(<Patients />) },
      { path: '/patients/:petId', element: load(<PetDetail />) },
      { path: '/appointments', element: load(<Appointments />) },
      { path: '/reminders', element: load(<Reminders />) },
      { path: '/inventory', element: load(<Inventory />) },
      { path: '/suppliers', element: load(<Suppliers />) },
      { path: '/reports', element: load(<Reports />) },
      { path: '/settings', element: load(<Settings />) },
      { path: '/knowledge', element: load(<Knowledge />) },
      { path: '*', element: <Navigate to="/dashboard" replace /> },
    ],
  },
])

export default function App() {
  return <RouterProvider router={router} />
}
