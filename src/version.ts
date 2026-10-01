import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// The one version is package.json's. A release tarball carries a RELEASE file beside it; a copy
// built from git doesn't, and says so: 0.2.0-dev+1a2b3c4.
export function version(): string {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const { version } = JSON.parse(readFileSync(root + 'package.json', 'utf8')) as { version: string }
  if (existsSync(root + 'RELEASE')) return version
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return `${version}-dev+${sha}`
  } catch {
    return `${version}-dev`
  }
}
