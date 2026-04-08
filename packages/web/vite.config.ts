import { defineConfig } from "vite"
import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import solidPlugin from "vite-plugin-solid"

export default defineConfig({
  plugins: [tailwindcss(), solidPlugin()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  worker: {
    format: "es",
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
  },
  build: {
    target: "esnext",
    // sourcemap: true,
  },
})
