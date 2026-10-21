import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "node:path";

// https://vitejs.dev/config/
export default defineConfig(() => {
  // Les appels aux outils (BitSight, Cortex, QRadar, Varonis) passent par les
  // Edge Functions Supabase, qui détiennent les secrets : pas de proxy ici.
  return {
    server: {
      host: "localhost",
      port: 8080,
      hmr: {
        overlay: false,
      },
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