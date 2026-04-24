import { defineConfig } from 'tsup'
import babel from 'esbuild-plugin-babel'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  splitting: true,
  outDir: 'dist',
  // Use esbuild-plugin-babel to run the React Compiler during the build
  esbuildPlugins: [
    babel({
      config: {
        presets: [
          ['@babel/preset-react', { runtime: 'automatic' }],
          '@babel/preset-typescript'
        ],
        plugins: [
          ['babel-plugin-react-compiler', { target: '19' }]
        ]
      }
    })
  ]
})
