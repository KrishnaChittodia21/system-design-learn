import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // relative asset URLs so the build works from any sub-path, e.g. GitHub Pages' /system-design-learn/
  base: './',
})
