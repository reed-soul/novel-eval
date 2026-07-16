import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolveWriterApiUrl } from '@novel-eval/shared';

const apiTarget = resolveWriterApiUrl(process.env);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': apiTarget,
    },
  },
  build: {
    outDir: 'dist',
  },
});
