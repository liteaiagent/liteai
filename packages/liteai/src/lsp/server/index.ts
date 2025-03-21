import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { Astro as _Astro } from "./astro"
import { BashLS as _BashLS } from "./bash"
import { Biome as _Biome } from "./biome"
import { Clangd as _Clangd } from "./clangd"
import { Clojure as _Clojure } from "./clojure"
import { CSharp as _CSharp } from "./csharp"
import { Dart as _Dart } from "./dart"
import { Deno as _Deno } from "./deno"
import { DockerfileLS as _DockerfileLS } from "./dockerfile"
import { ElixirLS as _ElixirLS } from "./elixir-ls"
import { ESLint as _ESLint } from "./eslint"
import { FSharp as _FSharp } from "./fsharp"
import { Gleam as _Gleam } from "./gleam"
import { Gopls as _Gopls } from "./gopls"
import { HLS as _HLS } from "./hls"
import { JDTLS as _JDTLS } from "./jdtls"
import { JuliaLS as _JuliaLS } from "./julia"
import { KotlinLS as _KotlinLS } from "./kotlin-ls"
import { LuaLS as _LuaLS } from "./lua-ls"
import { Nixd as _Nixd } from "./nixd"
import { Ocaml as _Ocaml } from "./ocaml"
import { Oxlint as _Oxlint } from "./oxlint"
import { PHPIntelephense as _PHPIntelephense } from "./php-intelephense"
import { Prisma as _Prisma } from "./prisma"
import { Pyright as _Pyright } from "./pyright"
import { Rubocop as _Rubocop } from "./rubocop"
import { RustAnalyzer as _RustAnalyzer } from "./rust-analyzer"
import { SourceKit as _SourceKit } from "./sourcekit"
import { Svelte as _Svelte } from "./svelte"
import { TerraformLS as _TerraformLS } from "./terraform"
import { TexLab as _TexLab } from "./texlab"
import { Tinymist as _Tinymist } from "./tinymist"
import { Ty as _Ty } from "./ty"
import { Typescript as _Typescript } from "./typescript"
import { Vue as _Vue } from "./vue"
import { YamlLS as _YamlLS } from "./yaml-ls"
import { Zls as _Zls } from "./zls"

export namespace LSPServer {
  export interface Handle {
    process: ChildProcessWithoutNullStreams
    initialization?: Record<string, unknown>
  }

  export interface Info {
    id: string
    extensions: string[]
    global?: boolean
    root: (file: string) => Promise<string | undefined>
    spawn(root: string): Promise<Handle | undefined>
  }

  export const Deno = _Deno
  export const Typescript = _Typescript
  export const Vue = _Vue
  export const ESLint = _ESLint
  export const Oxlint = _Oxlint
  export const Biome = _Biome
  export const Gopls = _Gopls
  export const Rubocop = _Rubocop
  export const Ty = _Ty
  export const Pyright = _Pyright
  export const ElixirLS = _ElixirLS
  export const Zls = _Zls
  export const CSharp = _CSharp
  export const FSharp = _FSharp
  export const SourceKit = _SourceKit
  export const RustAnalyzer = _RustAnalyzer
  export const Clangd = _Clangd
  export const Svelte = _Svelte
  export const Astro = _Astro
  export const JDTLS = _JDTLS
  export const KotlinLS = _KotlinLS
  export const YamlLS = _YamlLS
  export const LuaLS = _LuaLS
  export const PHPIntelephense = _PHPIntelephense
  export const Prisma = _Prisma
  export const Dart = _Dart
  export const Ocaml = _Ocaml
  export const BashLS = _BashLS
  export const TerraformLS = _TerraformLS
  export const TexLab = _TexLab
  export const DockerfileLS = _DockerfileLS
  export const Gleam = _Gleam
  export const Clojure = _Clojure
  export const Nixd = _Nixd
  export const Tinymist = _Tinymist
  export const HLS = _HLS
  export const JuliaLS = _JuliaLS
}
