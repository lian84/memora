import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Target del proxy per il backend durante lo sviluppo.
// Default: 127.0.0.1:3000 (lo stesso usato dal server Fastify).
// Sovrascrivibile tramite VITE_PROXY_TARGET.
const PROXY_TARGET = (process.env.VITE_PROXY_TARGET as string | undefined) ?? 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../dist/web',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: PROXY_TARGET,
        changeOrigin: true,
      },
    },
  },
});
