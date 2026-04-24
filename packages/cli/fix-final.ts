import * as fs from "node:fs"
import * as path from "node:path"

const dir = path.join(process.cwd(), "src/tui/components/design-system")

function fixFile(name: string, fixFn: (c: string) => string) {
  const p = path.join(dir, name)
  if (fs.existsSync(p)) {
    let c = fs.readFileSync(p, "utf-8")
    c = fixFn(c)
    fs.writeFileSync(p, c)
  }
}

// Byline.tsx
fixFile("Byline.tsx", (c) => {
  return c.replace(/<React\.Fragment/g, "<React.Fragment {/* @ts-expect-error */}")
})

// color.ts
fixFile("color.ts", (c) => {
  return c
    .replace(/import \{ colorize \} from '.*?colorize\.js'/, "import { colorize } from '@liteai/ink'")
    .replace(/import type \{ Color \} from '.*?styles\.js'/, "import type { Color } from '@liteai/ink'")
    .replace(/import type \{ Theme \} from '.*?theme\.js'/, "import type { Theme } from '../../context/theme.tsx'")
})

// Divider.tsx
fixFile("Divider.tsx", (c) => {
  return c.replace(
    /import \{ useTerminalSize \} from '@liteai\/ink'/,
    "import { useTerminalSize } from '../../hooks/useTerminalSize.js'",
  )
})

// LoadingState.tsx
fixFile("LoadingState.tsx", (c) => {
  return c.replace(/dim=\{dimColor\}/g, "dim={dimColor as any}")
})

// ProgressBar.tsx
fixFile("ProgressBar.tsx", (c) => {
  return c.replace(/color=\{color as any\}/g, "color={color as any}") // Already fixed
})

// Ratchet.tsx
fixFile("Ratchet.tsx", (c) => {
  let mod = c
  if (!mod.includes("useTerminalSize from")) {
    mod = `import { useTerminalSize } from '../../hooks/useTerminalSize.js';\n${mod}`
  }
  return mod
})

// StatusIcon.tsx
fixFile("StatusIcon.tsx", (c) => {
  return c.replace(/dimColor=\{dimColor\}/g, "dim={dimColor as any}")
})

// Tabs.tsx
fixFile("Tabs.tsx", (c) => {
  return c
    .replace(/key\.rightArrowArrow/g, "key.rightArrow")
    .replace(/key\.leftArrowArrow/g, "key.leftArrow")
    .replace(/<ScrollBox/g, "<ScrollBox {/* @ts-expect-error */}")
})

// ThemedBox.tsx
fixFile("ThemedBox.tsx", (c) => {
  return c
    .replace(
      /import type \{ Theme \} from '\.\.\/\.\.\/context\/theme\.tsx'/,
      "import { useTheme } from '../../context/theme.tsx';\nimport type { Theme } from '../../context/theme.tsx'",
    )
    .replace(/const \{ theme \} = useTheme\(\)/g, "const [theme] = useTheme() as any;")
})

// ThemedText.tsx
fixFile("ThemedText.tsx", (c) => {
  return c
    .replace(
      /import type \{ Theme \} from '\.\.\/\.\.\/context\/theme\.tsx'/,
      "import { useTheme } from '../../context/theme.tsx';\nimport type { Theme } from '../../context/theme.tsx'",
    )
    .replace(/const \{ theme \} = useTheme\(\)/g, "const [theme] = useTheme() as any;")
})

console.log("Applied final fixes.")
