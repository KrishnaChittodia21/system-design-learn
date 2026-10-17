import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// self-hosted variable fonts (woff2; browsers fetch only the unicode-range subsets a page uses):
// Unbounded = display headings and figures, Manrope = body and UI, JetBrains Mono = labels and code
import '@fontsource-variable/unbounded/wght.css'
import '@fontsource-variable/manrope/wght.css'
import '@fontsource-variable/jetbrains-mono/wght.css'
import './styles/index.css'
import App from './App.tsx'
import { applyThemeAttrs } from './lib/theme'
import { getProgress } from './lib/progress'

// set data-theme / data-accent before the first paint so there is no flash of the default theme
applyThemeAttrs(getProgress().settings)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
