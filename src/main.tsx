import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { savedLanguage, setLanguage } from './i18n'

const render = () =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )

// Before the first paint, so someone who chose Pidgin doesn't see a flash of English.
void setLanguage(savedLanguage()).finally(render)
