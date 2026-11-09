// The relay's limits and close codes, apart from index.ts: a Worker's entry module may export only
// its handlers and Durable Object classes. src/remote/link.ts and the app read the same codes.

// The largest message a side may send. The Mac's largest real ones (a first screen, a snapshot)
// are tens of kilobytes.
export const MAX_BYTES = 1 << 20

// Messages a socket may send in a minute. The Mac's busiest is ~10 screen frames a second for a
// few seconds after a key, then 2 and 1 a second (PACE in src/remote/screen.ts).
export const PER_MINUTE = 1200

// Another token holds the room.
export const REFUSED = 4001
export const TOO_BIG = 4009
export const TOO_MANY = 4029
