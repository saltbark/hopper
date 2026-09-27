// What Claude is told about the project when Hopper starts a conversation in it.
export const hopperPrompt = (key: string, openFile: string) =>
  [
    `This conversation was started from Hopper, for the project ${key}.`,
    `Its open items live in ${openFile}, one per line as "- [ ] **Title** — detail", under the file's first "## " heading.`,
    'Start by talking it through. When the person asks you to file, add or capture something, add it to that file',
    `(create it with "# ${key}" and "## Open" if it is missing) and say what you added.`,
    'Do not start on the work itself unless they ask.',
  ].join(' ')
