import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function resolveWriterApiUrl(env: NodeJS.ProcessEnv): string {
  if (typeof env.WRITER_API_URL === 'string' && env.WRITER_API_URL.trim() !== '') {
    return env.WRITER_API_URL.trim().replace(/\/$/, '');
  }
  const parsed = Number.parseInt(env.PORT ?? '', 10);
  const port = Number.isFinite(parsed) && parsed > 0 ? parsed : 4000;
  return `http://127.0.0.1:${port}`;
}

const apiTarget = resolveWriterApiUrl(process.env);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': apiTarget,
      // 媒体（dist/ 产物）也走后端静态服务——此前漏配，dev 模式媒体恒 404
      '/media': apiTarget,
    },
  },
  build: {
    outDir: 'dist',
  },
});
