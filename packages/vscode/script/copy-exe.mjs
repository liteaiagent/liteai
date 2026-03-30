import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const platformMap = {
  "win32-x64": "windows-x64",
  "darwin-arm64": "darwin-arm64",
  "darwin-x64": "darwin-x64",
  "linux-x64": "linux-x64",
  "linux-arm64": "linux-arm64",
}

function copyExe() {
  const coreDist = path.resolve(__dirname, "../../core/dist")
  const vscodeBin = path.resolve(__dirname, "../bin")

  if (!fs.existsSync(vscodeBin)) {
    fs.mkdirSync(vscodeBin, { recursive: true })
  }

  // Iterate over platforms
  for (const [_distPlatform, binPlatform] of Object.entries(platformMap)) {
    const srcFolder = path.join(coreDist, `liteai-core-${binPlatform}`, "bin")
    const destFolder = path.join(vscodeBin, binPlatform)

    if (!fs.existsSync(srcFolder)) {
      continue
    }

    if (!fs.existsSync(destFolder)) {
      fs.mkdirSync(destFolder, { recursive: true })
    }

    const files = fs.readdirSync(srcFolder)
    for (const file of files) {
      if (file.startsWith("liteai-core")) {
        fs.copyFileSync(path.join(srcFolder, file), path.join(destFolder, file))
        fs.chmodSync(path.join(destFolder, file), 0o755)
        console.log(`Copied ${file} for ${binPlatform}`)
      }
    }
  }
}

copyExe()
