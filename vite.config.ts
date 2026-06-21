import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      build: {
        chunkSizeWarningLimit: 900,
        rollupOptions: {
          output: {
            manualChunks(id) {
              if (!id.includes('node_modules')) {
                return;
              }

              if (id.includes('recharts')) {
                return 'charts';
              }

              if (id.includes('@tanstack/react-query')) {
                return 'react-query';
              }

              if (id.includes('react-router')) {
                return 'router';
              }

              if (id.includes('lucide-react')) {
                return 'icons';
              }

              return 'vendor';
            },
          },
        },
      },
      server: {
        port: 3000,
        host: '0.0.0.0',
        allowedHosts: true,
        proxy: {
          '/api': {
            target: env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8001',
            changeOrigin: true,
            rewrite: (requestPath) => requestPath.replace(/^\/api/, ''),
          },
        },
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
