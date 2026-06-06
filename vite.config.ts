import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

const enableHttps = process.env.VITE_HTTPS === 'true';
const allowedHosts = ['jarvis.smelt-dory.ts.net'];

export default defineConfig({
  plugins: enableHttps ? [react(), basicSsl()] : [react()],
  server: {
    host: '0.0.0.0',
    port: enableHttps ? 6002 : 6001,
    allowedHosts
  },
  preview: {
    host: '0.0.0.0',
    port: 8080,
    allowedHosts
  }
});
