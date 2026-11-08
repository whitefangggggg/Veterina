import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import PwaStatus from './components/PwaStatus.jsx'
import { AppearanceProvider } from './context/AppearanceContext.jsx'
import { AppErrorBoundary } from './components/ErrorViews.jsx'
import './refinements.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary><AppearanceProvider>
      <AuthProvider>
        <App />
        <PwaStatus />
      </AuthProvider>
    </AppearanceProvider></AppErrorBoundary>
  </StrictMode>,
)
