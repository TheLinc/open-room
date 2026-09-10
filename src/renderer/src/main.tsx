import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { followSystemColorScheme } from './lib/theme'

// Before the first render, so the first paint is already the right theme.
// The HTML carries no theme class of its own; this is what sets it.
followSystemColorScheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
