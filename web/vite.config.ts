import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  server: {
    // Matches PUBLIC_BASE_URL in .env.example, so dispatch and confirmation links open here.
    port: 5180,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:3020' },
  },
  build: {
    // WeChat's in-app browser is Chromium/WebKit based; keep the output conservative.
    target: ['es2019', 'safari13'],
  },
});
