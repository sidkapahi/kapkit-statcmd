import { resolve } from 'path';
import { defineConfig } from 'vite';

// Single-page app: just the customizer. (The source overlay repo also bundled a
// separate widget/ entry — this tool has no OBS overlay, so there's one input.)
export default defineConfig({
  base: '/',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
});
