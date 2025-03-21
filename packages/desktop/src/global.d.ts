interface LiteAIGlobals {
  deepLinks?: string[]
  wsl?: boolean
  updaterEnabled?: boolean
}

interface Window {
  __LITEAI__?: LiteAIGlobals
}
