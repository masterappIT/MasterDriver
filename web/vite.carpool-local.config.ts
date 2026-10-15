// Temporary, untracked: this branch's local preview on its own ports (removed after testing).
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  server: { port: 5190, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3030' } },
});
