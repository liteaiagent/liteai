declare module 'bidi-js' {
  interface BidiInstance {
    getEmbeddingLevels(text: string, direction: 'auto' | 'ltr' | 'rtl'): { levels: number[] }
  }
  function bidiFactory(): BidiInstance
  export default bidiFactory
}
