import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { ClinicDataProvider } from './context/ClinicDataContext.jsx'
import { AuthProvider } from './context/AuthContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider><ClinicDataProvider>
      <App />
    </ClinicDataProvider></AuthProvider>
  </StrictMode>,
)
