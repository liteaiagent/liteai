declare module "*.svg" {
  const content: string
  export default content
}

declare module "*.svg?raw" {
  const content: string
  export default content
}

declare module "*?worker&url" {
  const content: string
  export default content
}

declare const __LITEAI_DEV__: boolean
