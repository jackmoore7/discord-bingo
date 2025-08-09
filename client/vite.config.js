import {defineConfig} from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  envDir: '../',
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
    // hmr: {
    //   // Bind HMR to the local dev server port (avoid forcing :443 which causes
    //   // the browser to probe the host on port 443 repeatedly).
    //   host: 'localhost',
    //   port: 5173,
    // },
  },
});
