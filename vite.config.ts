import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "localhost",
    port: 8080,
    hmr: {
      overlay: false,
    },
    proxy: {
      '/api/bitsight': {
        target: 'https://api.bitsighttech.com',
        changeOrigin: true,
        secure: false, // <-- LA LIGNE MAGIQUE POUR CONTOURNER L'ERREUR SSL
        rewrite: (path) => path.replace(/^\/api\/bitsight/, '')
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
}));