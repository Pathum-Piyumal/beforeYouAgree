import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: false,
  plugins: [react(), tailwindcss(), {
    name: 'dashboard-entry',
    async generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'privacy.html', source: await readFile(resolve(import.meta.dirname, 'public/privacy.html'), 'utf8') })
    },
    transformIndexHtml: {
      order: 'pre',
      async handler() {
        return await readFile(resolve(import.meta.dirname, 'dashboard/index.html'), 'utf8')
      },
    },
  }],
  build: { outDir: 'dashboard-dist', rollupOptions: { input: resolve(import.meta.dirname, 'index.html') } },
})
