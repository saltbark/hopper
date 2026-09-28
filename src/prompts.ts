import type { Project } from './home.ts'

// What Claude is told about the project when Hopper starts a conversation in it.
export function hopperPrompt(project: Project): string {
  const { key, openFile, meta } = project
  const opening = `This conversation was started from Hopper, for the project ${key}.`
  // A registry project's open file belongs to its meta repo, which has its own planning rules.
  if (meta) {
    const where = meta.key
      ? `Its open items live in ${openFile}, in the meta repo ${meta.repo}.`
      : `This is the meta repo itself; each project's open items live in ${meta.repo}/planning/<key>/_open.md.`
    const code = meta.key ? (meta.link ?? project.path) : null
    return [
      opening,
      ...(code && project.runIn !== project.path
        ? [
            `You are running from the meta repo ${meta.repo} so its CLAUDE.md and conventions apply;`,
            `the project's code is in ${code}${meta.link ? ` (a link to ${project.path})` : ''}. Work there, and read its own CLAUDE.md before changing it.`,
          ]
        : []),
      where,
      `Before editing any planning file, read the planning rules in ${meta.repo}/CLAUDE.md and what it points to, and follow them`,
      '(which sections items go under, moving finished items to _done.md, dates, the planning check).',
      'When the person asks you to file, add or capture something, add it there and say what you added.',
      "If the open file doesn't exist yet, ask before creating it.",
      'Start by talking it through. Do not start on the work itself unless they ask.',
    ].join(' ')
  }
  return [
    opening,
    ...(project.runIn !== project.path ? [`Its folder is ${project.path}.`] : []),
    `Its open items live in ${openFile}, one per line as "- [ ] **Title** — detail", under the file's first "## " heading.`,
    'Start by talking it through. When the person asks you to file, add or capture something, add it to that file',
    `(create it with "# ${key}" and "## Open" if it is missing) and say what you added.`,
    'Do not start on the work itself unless they ask.',
  ].join(' ')
}
