import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: { input: { main: 'index.html', industry: 'industry/index.html' } },
  },
  server: { proxy: { '/api/v1': { target: 'http://127.0.0.1:8000', changeOrigin: true } } },
  preview: { proxy: { '/api/v1': { target: 'http://127.0.0.1:8000', changeOrigin: true } } },
});
