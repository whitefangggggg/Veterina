import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import PwaStatus from './components/PwaStatus.jsx'
import { AppearanceProvider } from './context/AppearanceContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppearanceProvider>
      <AuthProvider>
        <App />
        <PwaStatus />
      </AuthProvider>
    </AppearanceProvider>
  </StrictMode>,
)
