import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "node:path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Charge les variables d'environnement pour récupérer le FQDN de Cortex
  const env = loadEnv(mode, process.cwd(), '');

  return {
    server: {
      host: "localhost",
      port: 8080,
      hmr: {
        overlay: false,
      },
      proxy: {
        // Proxy existant pour BitSight
        '/api/bitsight': {
          target: 'https://api.bitsighttech.com',
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/api\/bitsight/, '')
        },
        // Nouveau proxy pour Cortex XSIAM
        '/api/cortex': {
          target: `https://${env.VITE_CORTEX_FQDN}`,
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/api\/cortex/, '')
        }
      }
    },
    plugins: [
      react(),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
    },
  };
});