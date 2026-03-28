import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import solidPlugin from "vite-plugin-solid"

/**
 * @type {import("vite").PluginOption}
 */
export default [
  {
    name: "liteai-desktop:config",
    config() {
      return {
        resolve: {
          alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
          },
        },
        worker: {
          format: "es",
        },
      }
    },
  },
  tailwindcss(),
  solidPlugin(),
]
