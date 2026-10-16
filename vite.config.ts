import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], server: { proxy: { '/api': process.env.YTRADER_API_PROXY ?? 'http://127.0.0.1:4340' } }, build: { outDir: 'dist' } });
