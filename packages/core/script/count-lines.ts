import { join } from "node:path"
import { Glob } from "bun"

async function countLines(filePath: string): Promise<number> {
  const file = Bun.file(filePath)
  const text = await file.text()
  return text.split("\n").length
}

async function scan(dirName: string, outFileName: string) {
  const root = join(import.meta.dir, "..", dirName)
  const glob = new Glob("**/*.{ts,tsx,js,jsx,sql}")
  const results: { file: string; lines: number }[] = []

  for await (const file of glob.scan(root)) {
    const fullPath = join(root, file)
    try {
      const lines = await countLines(fullPath)
      results.push({ file, lines })
    } catch {
      // ignore unreadable files
    }
  }

  results.sort((a, b) => b.lines - a.lines)
  const output = results.map((x) => `${x.lines}\t${x.file}`).join("\n")
  const outPath = join(import.meta.dir, "..", outFileName)
  await Bun.write(outPath, output)
  console.log(`Wrote ${results.length} records to ${outPath}`)
}

async function run() {
  await scan("src", "src-lines.txt")
  await scan("test", "test-lines.txt")
}

run().catch(console.error)
