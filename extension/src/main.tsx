import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './popup/App'
import Dashboard from './dashboard/App'
import './index.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('Popup root element was not found.')
}

createRoot(root).render(
  <StrictMode>
    {window.location.hash === '#dashboard' ? <Dashboard /> : <App />}
  </StrictMode>,
)
