import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

// A file's text, or null when it isn't there. Any other failure is still an error.
export async function readIfThere(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
}

// Written whole, through a temp file beside it, so a crash never leaves half a file. Each write
// has its own temp file: two at once (an autosave and a save on esc) mustn't share one.
let writes = 0
export async function writeAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}-${++writes}.tmp`
  try {
    await writeFile(tmp, text)
    await rename(tmp, path)
  } catch (e) {
    await rm(tmp, { force: true })
    throw e
  }
}

export const writeJson = (path: string, value: unknown) =>
  writeAtomic(path, JSON.stringify(value, null, 2) + '\n')

// A state file read in order to change it. One that doesn't parse (a Dropbox conflict, half a
// sync) is moved aside to `<name>.unreadable-<time>` and the change starts from empty, so writing
// it back never destroys what was in it.
export async function readForChange<T>(
  path: string,
  parse: (text: string | null) => T,
): Promise<T> {
  const text = await readIfThere(path)
  try {
    return parse(text)
  } catch {
    await rename(path, `${path}.unreadable-${Date.now()}`)
    return parse(null)
  }
}

// Runs `fn` after any earlier call for the same file has finished, so two changes read, change
// and write it back one after the other rather than one losing the other's.
const turns = new Map<string, Promise<unknown>>()
export function inTurn<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const run = (turns.get(path) ?? Promise.resolve()).then(fn, fn)
  const settled = run.catch(() => {})
  turns.set(path, settled)
  void settled.then(() => turns.get(path) === settled && turns.delete(path))
  return run
}

// A lock file, for work two Hopper windows mustn't both do. Resolves with its release, or null
// when it's held. One older than ten minutes was left by a crash, and is taken over.
export async function tryLock(path: string): Promise<(() => Promise<void>) | null> {
  await mkdir(dirname(path), { recursive: true })
  const stale = await stat(path).then(
    (s) => Date.now() - s.mtimeMs > 10 * 60_000,
    () => false,
  )
  if (stale) await rm(path, { force: true })
  try {
    const fh = await open(path, 'wx')
    await fh.close()
    return () => rm(path, { force: true })
  } catch {
    return null
  }
}
