// The terminal tab's title: "Hopper", and how many conversations need you when any do, so a
// waiting agent shows from another tab. The terminal's own title is saved on the way in and put
// back on the way out (xterm's title stack; terminals without it keep "Hopper").

export const TITLE_SAVE = '\x1b[22;0t'
export const TITLE_RESTORE = '\x1b[23;0t'

export const titleText = (needs: number) => (needs > 0 ? `Hopper (${needs})` : 'Hopper')

// OSC 0 sets both the tab and the window title.
export const titleSeq = (text: string) => `\x1b]0;${text}\x07`
