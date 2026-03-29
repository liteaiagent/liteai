/// <reference types="vite/client" />
import "solid-js"

interface ImportMetaEnv {
  readonly VITE_LITEAI_SERVER_HOST: string
  readonly VITE_LITEAI_SERVER_PORT: string
}

// biome-ignore lint/correctness/noUnusedVariables: Used by typescript for Vite env types
interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "solid-js" {
  namespace JSX {
    interface Directives {
      sortable: true
    }
  }
}
