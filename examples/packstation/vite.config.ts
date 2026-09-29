import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/v1/api': {
        // Add API base url here before starting!
        target: '',
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
