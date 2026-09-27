import { homedir } from 'node:os'
import { join } from 'node:path'

export function expandHome(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/')) return join(homedir(), p.slice(2))
  return p
}

export function tildify(p: string): string {
  const home = homedir()
  if (p === home) return '~'
  if (p.startsWith(home + '/')) return '~' + p.slice(home.length)
  return p
}

export function configPath(): string {
  const override = process.env['HOPPER_CONFIG']
  return override ? expandHome(override) : join(homedir(), '.config', 'hopper', 'config.toml')
}

// True when `child` is `parent` or sits somewhere below it.
export function isWithin(child: string, parent: string): boolean {
  const p = parent.endsWith('/') ? parent.slice(0, -1) : parent
  return child === p || child.startsWith(p + '/')
}
