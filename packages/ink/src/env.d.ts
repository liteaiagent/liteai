import 'react'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'ink-box': Record<string, any>
      'ink-text': Record<string, any>
      'ink-raw-ansi': Record<string, any>
      'ink-link': Record<string, any>
    }
  }
}
