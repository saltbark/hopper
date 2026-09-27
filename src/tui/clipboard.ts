import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

// The Mac clipboard. Quietly does nothing where pbcopy isn't there.
export function copyToClipboard(text: string) {
  // Tests point this at a file so they never touch the real clipboard.
  const file = process.env['HOPPER_CLIPBOARD_FILE']
  if (file) return writeFileSync(file, text)
  try {
    const child = spawn('pbcopy', [], { stdio: ['pipe', 'ignore', 'ignore'] })
    child.on('error', () => {})
    child.stdin.end(text)
  } catch {
    // no clipboard
  }
}
