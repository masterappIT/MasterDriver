import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5181,
    strictPort: true,
    // Same-origin /api in development, matching production behind one domain.
    proxy: { '/api': 'http://127.0.0.1:3020' },
  },
});
