// Cuts a release: pnpm release patch|minor|major|<x.y.z>. Sets the version in package.json, adds
// its CHANGELOG.md entry (the commits since the last tag, opened in $EDITOR to tidy), commits, and
// tags vX.Y.Z. Pushing is left to you; the tag's push runs .github/workflows/release.yml, which
// builds the tarball and publishes the GitHub Release.
// Naming the version package.json already has releases it as it is, as for the first one.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const git = (...args: string[]) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const fail = (message: string): never => {
  console.error(message)
  process.exit(1)
}

const arg = process.argv[2] ?? fail('pnpm release patch|minor|major|<x.y.z>')
if (git('branch', '--show-current') !== 'main') fail('Release from main.')
if (git('status', '--porcelain')) fail('Commit or put away your changes first.')

const pkg = readFileSync('package.json', 'utf8')
const current = (JSON.parse(pkg) as { version: string }).version
const [major, minor, patch] = current.split('.').map(Number) as [number, number, number]
const next =
  arg === 'major'
    ? `${major + 1}.0.0`
    : arg === 'minor'
      ? `${major}.${minor + 1}.0`
      : arg === 'patch'
        ? `${major}.${minor}.${patch + 1}`
        : /^\d+\.\d+\.\d+$/.test(arg)
          ? arg
          : fail(`"${arg}" isn't patch, minor, major or a version like 1.2.3.`)
const tag = `v${next}`
if (git('tag', '--list', tag)) fail(`${tag} is already tagged.`)

let last = ''
try {
  last = git('describe', '--tags', '--abbrev=0')
} catch {}
const changes = last
  ? git('log', '--format=- %s', `${last}..HEAD`) || '- Nothing but the version.'
  : '- The first release.'
const day = new Date().toISOString().slice(0, 10)
const old = existsSync('CHANGELOG.md')
  ? readFileSync('CHANGELOG.md', 'utf8').replace(/^# Changelog\n+/, '')
  : ''
writeFileSync(
  'CHANGELOG.md',
  `# Changelog\n\n## ${next} (${day})\n\n${changes}\n\n${old}`.trimEnd() + '\n',
)
if (process.env['EDITOR'] && process.stdin.isTTY)
  spawnSync(process.env['EDITOR'], ['CHANGELOG.md'], { stdio: 'inherit', shell: true })

if (next !== current)
  writeFileSync('package.json', pkg.replace(`"version": "${current}"`, `"version": "${next}"`))
git('add', 'package.json', 'CHANGELOG.md')
git('commit', '-m', `Release ${tag}`)
git('tag', '-a', tag, '-m', `Hopper ${next}`)
console.log(`Tagged ${tag}. To publish it:\n\n  git push origin main ${tag}\n`)
