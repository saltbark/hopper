#!/usr/bin/env node
// React's development build checks every render and runs at about half the speed. React and
// Ink's reconciler (and the JSX runtime, which Ink doesn't load) choose their build once, as they load, so NODE_ENV is set only for that and
// put back after: the `claude` processes Hopper starts inherit its environment. `pnpm dev`
// keeps the development build.
const env = process.env.NODE_ENV
process.env.NODE_ENV ??= 'production'
await import('ink')
await import('react/jsx-runtime')
if (env === undefined) delete process.env.NODE_ENV
await import('../dist/cli.js')
