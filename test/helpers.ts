import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// A stand-in `claude`: a shell script with the given body, in its own folder unless one is
// given. Returns its path.
export async function fakeClaude(body: string, dir?: string): Promise<string> {
  const bin = join(dir ?? (await mkdtemp(join(tmpdir(), 'hopper-bin-'))), 'claude')
  await writeFile(bin, `#!/bin/sh\n${body}\n`)
  await chmod(bin, 0o755)
  return bin
}
