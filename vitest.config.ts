import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Claude Code keeps worktrees in .claude/worktrees/, each a full copy of the repo with its own
    // tests; run only this checkout's.
    exclude: [...configDefaults.exclude, '.claude/**', 'release/**'],
    // The app tests render Ink for a few seconds each; on a busy machine or a small CI runner the
    // default 5s times some out.
    testTimeout: 20_000,
    // The app runs routines and dispatch on its own; tests that want it turn it on.
    env: { HOPPER_NO_AUTOPILOT: '1' },
  },
})
