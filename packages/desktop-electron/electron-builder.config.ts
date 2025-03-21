import type { Configuration } from "electron-builder"

const channel = (() => {
  const raw = process.env.LITEAI_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
})()

const getBase = (): Configuration => ({
  artifactName: "liteai-electron-${os}-${arch}.${ext}",
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  files: ["out/**/*", "resources/**/*"],
  extraResources: [
    {
      from: "resources/",
      to: "",
      filter: ["liteai-cli*"],
    },
    {
      from: "native/",
      to: "native/",
      filter: ["index.js", "index.d.ts", "build/Release/mac_window.node", "swift-build/**"],
    },
  ],
  mac: {
    category: "public.app-category.developer-tools",
    icon: `resources/icons/icon.icns`,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    notarize: true,
    target: ["dmg", "zip"],
  },
  dmg: {
    sign: true,
  },
  protocols: {
    name: "LiteAI",
    schemes: ["liteai"],
  },
  win: {
    icon: `resources/icons/icon.ico`,
    target: ["nsis"],
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    installerIcon: `resources/icons/icon.ico`,
    installerHeaderIcon: `resources/icons/icon.ico`,
  },
  linux: {
    icon: `resources/icons`,
    category: "Development",
    target: ["AppImage", "deb", "rpm"],
  },
})

function getConfig() {
  const base = getBase()

  switch (channel) {
    case "dev": {
      return {
        ...base,
        appId: "ai.liteai.desktop.dev",
        productName: "LiteAI Dev",
        rpm: { packageName: "liteai-dev" },
      }
    }
    case "beta": {
      return {
        ...base,
        appId: "ai.liteai.desktop.beta",
        productName: "LiteAI Beta",
        protocols: { name: "LiteAI Beta", schemes: ["liteai"] },
        publish: { provider: "github", owner: "liteaiagent", repo: "liteai", channel: "latest" },
        rpm: { packageName: "liteai-beta" },
      }
    }
    case "prod": {
      return {
        ...base,
        appId: "ai.liteai.desktop",
        productName: "LiteAI",
        protocols: { name: "LiteAI", schemes: ["liteai"] },
        publish: { provider: "github", owner: "liteaiagent", repo: "liteai", channel: "latest" },
        rpm: { packageName: "liteai" },
      }
    }
  }
}

export default getConfig()
