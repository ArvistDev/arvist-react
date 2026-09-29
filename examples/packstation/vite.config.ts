import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  // Loaded from `.env`/`.env.local` (gitignored) rather than hardcoded here,
  // so the real deployment URL never ends up committed to this tracked file.
  // See `.env.example` — copy it to `.env` and set `VITE_ARVIST_URL`.
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: env.VITE_ARVIST_URL
        ? {
            '/v1/api': {
              target: env.VITE_ARVIST_URL,
              changeOrigin: true,
              secure: true,
            },
          }
        : undefined,
    },
  };
});
