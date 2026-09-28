import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Claude Code keeps worktrees in .claude/worktrees/, each a full copy of the repo with its own
    // tests; run only this checkout's.
    exclude: [...configDefaults.exclude, '.claude/**'],
    // The app runs routines and dispatch on its own; tests that want it turn it on.
    env: { HOPPER_NO_AUTOPILOT: '1' },
  },
})
