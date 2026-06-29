import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base so the static build works from any host or sub-path.
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  // Pre-bundle the heavy parsers at startup so the dev server doesn't reload mid-session
  // the first time each is dynamically imported.
  optimizeDeps: {
    include: ['xlsx', 'jszip', 'postal-mime', 'mammoth/mammoth.browser', 'pdfjs-dist', '@xmldom/xmldom', 'pdf-lib']
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 }
})
