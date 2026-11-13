import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = process.env.VITE_API_PROXY ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API, changeOrigin: false },
      '/media': { target: API, changeOrigin: false },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Painel interno em chunk separado: o espectador da live nunca baixa esse código.
        manualChunks: (id) => (id.includes('/src/admin/') ? 'admin' : undefined),
      },
    },
  },
});
