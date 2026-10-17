import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// self-hosted variable fonts (woff2; browsers fetch only the unicode-range subsets a page uses)
import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/newsreader/opsz.css'
import '@fontsource-variable/jetbrains-mono/wght.css'
import './index.css'
import './prism-theme.css'
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
