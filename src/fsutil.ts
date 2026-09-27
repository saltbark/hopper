import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
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

// Written whole, through a temp file beside it, so a crash never leaves half a file.
export async function writeAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  await writeFile(tmp, text)
  await rename(tmp, path)
}

export const writeJson = (path: string, value: unknown) =>
  writeAtomic(path, JSON.stringify(value, null, 2) + '\n')
