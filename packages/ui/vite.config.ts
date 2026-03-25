import fs from "node:fs"
import { defineConfig } from "vite"
import { iconsSpritesheet } from "vite-plugin-icons-spritesheet"
import solidPlugin from "vite-plugin-solid"

export default defineConfig({
  plugins: [
    solidPlugin(),
    providerIconsPlugin(),
    iconsSpritesheet([
      {
        withTypes: true,
        inputDir: "src/assets/icons/file-types",
        outputDir: "src/components/file-icons",
        formatter: "biome",
      },
      {
        withTypes: true,
        inputDir: "src/assets/icons/provider",
        outputDir: "src/components/provider-icons",
        formatter: "biome",
        iconNameTransformer: (iconName) => iconName,
      },
    ]),
  ],
  server: { port: 3001 },
  build: {
    target: "esnext",
  },
  worker: {
    format: "es",
  },
})

function providerIconsPlugin() {
  return {
    name: "provider-icons-plugin",
    configureServer() {
      fetchProviderIcons()
    },
    buildStart() {
      fetchProviderIcons()
    },
  }
}

async function fetchProviderIcons() {
  const url = process.env.LITEAI_MODELS_URL || "https://models.dev"
  const providers = await fetch(`${url}/api.json`)
    .then((res) => res.json())
    .then((json) => Object.keys(json))
  await Promise.all(
    providers.map((provider) =>
      fetch(`${url}/logos/${provider}.svg`)
        .then((res) => res.text())
        .then((svg) => fs.writeFileSync(`./src/assets/icons/provider/${provider}.svg`, svg)),
    ),
  )
}
