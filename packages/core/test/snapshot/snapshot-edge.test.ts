import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { $ } from "bun"
import { Instance } from "../../src/project/instance"
import { Snapshot } from "../../src/snapshot"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

// Git always outputs /-separated paths internally. Snapshot.patch() joins them
// with path.join (which produces \\ on Windows) then normalizes back to /.
// This helper does the same for expected values so assertions match cross-platform.
const fwd = (...parts: string[]) => path.join(...parts).replaceAll("\\", "/")

async function bootstrap() {
  return tmpdir({
    git: true,
    init: async (dir) => {
      const unique = Math.random().toString(36).slice(2)
      const aContent = `A${unique}`
      const bContent = `B${unique}`
      await Filesystem.write(`${dir}/a.txt`, aContent)
      await Filesystem.write(`${dir}/b.txt`, bContent)
      await $`git add .`.cwd(dir).quiet()
      await $`git commit --no-gpg-sign -m init`.cwd(dir).quiet()
      return {
        aContent,
        bContent,
      }
    },
  })
}

test("unicode filenames", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      if (!before) throw new Error("expected snapshot")

      const unicodeFiles = [
        { path: fwd(tmp.path, "文件.txt"), content: "chinese content" },
        { path: fwd(tmp.path, "🚀rocket.txt"), content: "emoji content" },
        { path: fwd(tmp.path, "café.txt"), content: "accented content" },
        { path: fwd(tmp.path, "файл.txt"), content: "cyrillic content" },
      ]

      for (const file of unicodeFiles) {
        await Filesystem.write(file.path, file.content)
      }

      const patch = await Snapshot.patch(before)
      expect(patch.files.length).toBe(4)

      for (const file of unicodeFiles) {
        expect(patch.files).toContain(file.path)
      }

      await Snapshot.revert([patch])

      for (const file of unicodeFiles) {
        expect(
          await fs
            .access(file.path)
            .then(() => true)
            .catch(() => false),
        ).toBe(false)
      }
    },
  })
}, 30_000)

test.skip("unicode filenames modification and restore", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const chineseFile = fwd(tmp.path, "文件.txt")
      const cyrillicFile = fwd(tmp.path, "файл.txt")

      await Filesystem.write(chineseFile, "original chinese")
      await Filesystem.write(cyrillicFile, "original cyrillic")

      const before = await Snapshot.track()
      if (!before) throw new Error("expected snapshot")

      await Filesystem.write(chineseFile, "modified chinese")
      await Filesystem.write(cyrillicFile, "modified cyrillic")

      const patch = await Snapshot.patch(before)
      expect(patch.files).toContain(chineseFile)
      expect(patch.files).toContain(cyrillicFile)

      await Snapshot.revert([patch])

      expect(await fs.readFile(chineseFile, "utf-8")).toBe("original chinese")
      expect(await fs.readFile(cyrillicFile, "utf-8")).toBe("original cyrillic")
    },
  })
}, 30_000)

test("unicode filenames in subdirectories", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      if (!before) throw new Error("expected snapshot")

      await $`mkdir -p "${tmp.path}/目录/подкаталог"`.quiet()
      const deepFile = fwd(tmp.path, "目录", "подкаталог", "文件.txt")
      await Filesystem.write(deepFile, "deep unicode content")

      const patch = await Snapshot.patch(before)
      expect(patch.files).toContain(deepFile)

      await Snapshot.revert([patch])
      expect(
        await fs
          .access(deepFile)
          .then(() => true)
          .catch(() => false),
      ).toBe(false)
    },
  })
}, 30_000)

test("very long filenames", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      if (!before) throw new Error("expected snapshot")

      const longName = `${"a".repeat(100)}.txt`
      const longFile = fwd(tmp.path, longName)

      await Filesystem.write(longFile, "long filename content")

      const patch = await Snapshot.patch(before)
      expect(patch.files).toContain(longFile)

      await Snapshot.revert([patch])
      expect(
        await fs
          .access(longFile)
          .then(() => true)
          .catch(() => false),
      ).toBe(false)
    },
  })
}, 10_000)

test("hidden files", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      if (!before) throw new Error("expected snapshot")

      await Filesystem.write(`${tmp.path}/.hidden`, "hidden content")
      await Filesystem.write(`${tmp.path}/.gitignore`, "*.log")
      await Filesystem.write(`${tmp.path}/.config`, "config content")

      const patch = await Snapshot.patch(before)
      expect(patch.files).toContain(fwd(tmp.path, ".hidden"))
      expect(patch.files).toContain(fwd(tmp.path, ".gitignore"))
      expect(patch.files).toContain(fwd(tmp.path, ".config"))
    },
  })
}, 30_000)

test("nested symlinks", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      if (!before) throw new Error("expected snapshot")

      await $`mkdir -p ${tmp.path}/sub/dir`.quiet()
      await Filesystem.write(`${tmp.path}/sub/dir/target.txt`, "target content")
      await fs.symlink(`${tmp.path}/sub/dir/target.txt`, `${tmp.path}/sub/dir/link.txt`, "file")
      await fs.symlink(`${tmp.path}/sub`, `${tmp.path}/sub-link`, "dir")

      const patch = await Snapshot.patch(before)
      expect(patch.files).toContain(fwd(tmp.path, "sub", "dir", "link.txt"))
      expect(patch.files).toContain(fwd(tmp.path, "sub-link"))
    },
  })
}, 30_000)

test.skipIf(process.platform === "win32")(
  "file permissions and ownership changes",
  async () => {
    await using tmp = await bootstrap()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const before = await Snapshot.track()
        if (!before) throw new Error("expected snapshot")

        // Change permissions multiple times
        await $`chmod 600 ${tmp.path}/a.txt`.quiet()
        await $`chmod 755 ${tmp.path}/a.txt`.quiet()
        await $`chmod 644 ${tmp.path}/a.txt`.quiet()

        const patch = await Snapshot.patch(before)
        // Note: git doesn't track permission changes on existing files by default
        // Only tracks executable bit when files are first added
        expect(patch.files.length).toBe(0)
      },
    })
  },
  30_000,
)

test("circular symlinks", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      if (!before) throw new Error("expected snapshot")

      // Create circular symlink
      await fs.symlink(`${tmp.path}/circular`, `${tmp.path}/circular`, "dir").catch(() => {})

      const patch = await Snapshot.patch(before)
      expect(patch.files.length).toBeGreaterThanOrEqual(0) // Should not crash
    },
  })
}, 30_000)

test("gitignore changes", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      if (!before) throw new Error("expected snapshot")

      await Filesystem.write(`${tmp.path}/.gitignore`, "*.ignored")
      await Filesystem.write(`${tmp.path}/test.ignored`, "ignored content")
      await Filesystem.write(`${tmp.path}/normal.txt`, "normal content")

      const patch = await Snapshot.patch(before)

      // Should track gitignore itself
      expect(patch.files).toContain(fwd(tmp.path, ".gitignore"))
      // Should track normal files
      expect(patch.files).toContain(fwd(tmp.path, "normal.txt"))
      // Should not track ignored files (git won't see them)
      expect(patch.files).not.toContain(fwd(tmp.path, "test.ignored"))
    },
  })
}, 30_000)

test("git info exclude changes", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      if (!before) throw new Error("expected snapshot")

      const file = `${tmp.path}/.git/info/exclude`
      const text = await Bun.file(file).text()
      await Bun.write(file, `${text.trimEnd()}\nignored.txt\n`)
      await Bun.write(`${tmp.path}/ignored.txt`, "ignored content")
      await Bun.write(`${tmp.path}/normal.txt`, "normal content")

      const patch = await Snapshot.patch(before)
      expect(patch.files).toContain(fwd(tmp.path, "normal.txt"))
      expect(patch.files).not.toContain(fwd(tmp.path, "ignored.txt"))

      const after = await Snapshot.track()
      if (!after) throw new Error("expected snapshot")
      const diffs = await Snapshot.diffFull(before, after)
      expect(diffs.some((x) => x.file === "normal.txt")).toBe(true)
      expect(diffs.some((x) => x.file === "ignored.txt")).toBe(false)
    },
  })
}, 30_000)

test("git info exclude keeps global excludes", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const global = `${tmp.path}/global.ignore`
      const config = `${tmp.path}/global.gitconfig`
      await Bun.write(global, "global.tmp\n")
      await Bun.write(config, `[core]\n\texcludesFile = ${global.replaceAll("\\", "/")}\n`)

      const prev = process.env.GIT_CONFIG_GLOBAL
      process.env.GIT_CONFIG_GLOBAL = config
      try {
        const before = await Snapshot.track()
        if (!before) throw new Error("expected snapshot")

        const file = `${tmp.path}/.git/info/exclude`
        const text = await Bun.file(file).text()
        await Bun.write(file, `${text.trimEnd()}\ninfo.tmp\n`)

        await Bun.write(`${tmp.path}/global.tmp`, "global content")
        await Bun.write(`${tmp.path}/info.tmp`, "info content")
        await Bun.write(`${tmp.path}/normal.txt`, "normal content")

        const patch = await Snapshot.patch(before)
        expect(patch.files).toContain(fwd(tmp.path, "normal.txt"))
        expect(patch.files).not.toContain(fwd(tmp.path, "global.tmp"))
        expect(patch.files).not.toContain(fwd(tmp.path, "info.tmp"))
      } finally {
        if (prev) process.env.GIT_CONFIG_GLOBAL = prev
        else delete process.env.GIT_CONFIG_GLOBAL
      }
    },
  })
}, 30_000)

test("concurrent file operations during patch", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      if (!before) throw new Error("expected snapshot")

      // Start creating files
      const createPromise = (async () => {
        for (let i = 0; i < 10; i++) {
          await Filesystem.write(`${tmp.path}/concurrent${i}.txt`, `concurrent${i}`)
          // Small delay to simulate concurrent operations
          await new Promise((resolve) => setTimeout(resolve, 1))
        }
      })()

      // Get patch while files are being created
      const patchPromise = Snapshot.patch(before)

      await createPromise
      const patch = await patchPromise

      // Should capture some or all of the concurrent files
      expect(patch.files.length).toBeGreaterThanOrEqual(0)
    },
  })
}, 30_000)

test("snapshot state isolation between projects", async () => {
  // Test that different projects don't interfere with each other
  await using tmp1 = await bootstrap()
  await using tmp2 = await bootstrap()

  await Instance.provide({
    directory: tmp1.path,
    fn: async () => {
      const before1 = await Snapshot.track()
      if (!before1) throw new Error("expected snapshot")
      await Filesystem.write(`${tmp1.path}/project1.txt`, "project1 content")
      const patch1 = await Snapshot.patch(before1)
      expect(patch1.files).toContain(fwd(tmp1.path, "project1.txt"))
    },
  })

  await Instance.provide({
    directory: tmp2.path,
    fn: async () => {
      const before2 = await Snapshot.track()
      if (!before2) throw new Error("expected snapshot")
      await Filesystem.write(`${tmp2.path}/project2.txt`, "project2 content")
      const patch2 = await Snapshot.patch(before2)
      expect(patch2.files).toContain(fwd(tmp2.path, "project2.txt"))

      // Ensure project1 files don't appear in project2
      expect(patch2.files).not.toContain(fwd(tmp1?.path ?? "", "project1.txt"))
    },
  })
}, 60_000)

test("patch detects changes in secondary worktree", async () => {
  await using tmp = await bootstrap()
  const worktreePath = `${tmp.path}-worktree`
  await $`git worktree add ${worktreePath} HEAD`.cwd(tmp.path).quiet()

  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(await Snapshot.track()).toBeTruthy()
      },
    })

    await Instance.provide({
      directory: worktreePath,
      fn: async () => {
        const before = await Snapshot.track()
        if (!before) throw new Error("expected snapshot")

        const worktreeFile = fwd(worktreePath, "worktree.txt")
        await Filesystem.write(worktreeFile, "worktree content")

        const patch = await Snapshot.patch(before)
        expect(patch.files).toContain(worktreeFile)
      },
    })
  } finally {
    await $`git worktree remove --force ${worktreePath}`.cwd(tmp.path).quiet().nothrow()
    await $`rm -rf ${worktreePath}`.quiet()
  }
}, 10_000)

test("revert only removes files in invoking worktree", async () => {
  await using tmp = await bootstrap()
  const worktreePath = `${tmp.path}-worktree`
  await $`git worktree add ${worktreePath} HEAD`.cwd(tmp.path).quiet()

  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(await Snapshot.track()).toBeTruthy()
      },
    })
    const primaryFile = `${tmp.path}/worktree.txt`
    await Filesystem.write(primaryFile, "primary content")

    await Instance.provide({
      directory: worktreePath,
      fn: async () => {
        const before = await Snapshot.track()
        if (!before) throw new Error("expected snapshot")

        const worktreeFile = fwd(worktreePath, "worktree.txt")
        await Filesystem.write(worktreeFile, "worktree content")

        const patch = await Snapshot.patch(before)
        await Snapshot.revert([patch])

        expect(
          await fs
            .access(worktreeFile)
            .then(() => true)
            .catch(() => false),
        ).toBe(false)
      },
    })

    expect(await fs.readFile(primaryFile, "utf-8")).toBe("primary content")
  } finally {
    await $`git worktree remove --force ${worktreePath}`.cwd(tmp.path).quiet().nothrow()
    await $`rm -rf ${worktreePath}`.quiet()
    await $`rm -f ${tmp.path}/worktree.txt`.quiet()
  }
}, 30_000)

test("diff reports worktree-only/shared edits and ignores primary-only", async () => {
  await using tmp = await bootstrap()
  const worktreePath = `${tmp.path}-worktree`
  await $`git worktree add ${worktreePath} HEAD`.cwd(tmp.path).quiet()

  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(await Snapshot.track()).toBeTruthy()
      },
    })

    await Instance.provide({
      directory: worktreePath,
      fn: async () => {
        const before = await Snapshot.track()
        if (!before) throw new Error("expected snapshot")

        await Filesystem.write(`${worktreePath}/worktree-only.txt`, "worktree diff content")
        await Filesystem.write(`${worktreePath}/shared.txt`, "worktree edit")
        await Filesystem.write(`${tmp.path}/shared.txt`, "primary edit")
        await Filesystem.write(`${tmp.path}/primary-only.txt`, "primary change")

        const diff = await Snapshot.diff(before)
        expect(diff).toContain("worktree-only.txt")
        expect(diff).toContain("shared.txt")
        expect(diff).not.toContain("primary-only.txt")
      },
    })
  } finally {
    await $`git worktree remove --force ${worktreePath}`.cwd(tmp.path).quiet().nothrow()
    await $`rm -rf ${worktreePath}`.quiet()
    await $`rm -f ${tmp.path}/shared.txt`.quiet()
    await $`rm -f ${tmp.path}/primary-only.txt`.quiet()
  }
}, 30_000)
