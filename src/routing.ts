import type { Account, Config, Route } from './config.ts'
import { isStale } from './format.ts'
import type { AccountState } from './model.ts'

// The route for a key: the longest prefix that matches. "" matches everything.
export function routeFor(config: Config, key: string): Route | undefined {
  let best: Route | undefined
  for (const r of config.routes) {
    const matches = r.prefix === '' || key.startsWith(r.prefix) || key + '/' === r.prefix
    if (matches && (!best || r.prefix.length > best.prefix.length)) best = r
  }
  return best
}

// Room means below these, on usage that is still current. Unknown or out-of-date usage counts
// as room: Hopper would rather try than stall on a guess.
const LIMITS = { fiveHour: 90, sevenDay: 95 }

export function hasRoom(state: AccountState | undefined): boolean {
  if (!state?.auth?.loggedIn) return false
  const u = state.usage
  if (!u) return true
  const over = (w: typeof u.fiveHour, limit: number) =>
    !!w && !isStale(w.resetsAt) && w.pct >= limit
  return !over(u.fiveHour, LIMITS.fiveHour) && !over(u.sevenDay, LIMITS.sevenDay)
}

export type Pick = { account: Account | undefined; route: Route | undefined; reason: string }

export function pickAccount(config: Config, key: string, states: AccountState[]): Pick {
  const route = routeFor(config, key)
  // With a single account and no routes yet, there's nothing to choose: use it.
  const only = config.accounts.length === 1 ? config.accounts[0] : undefined
  if (!route && only && states.find((st) => st.account.name === only.name)?.auth?.loggedIn) {
    return { account: only, route, reason: 'the only account' }
  }
  if (!route)
    return {
      account: undefined,
      route,
      reason: `no account runs ${key}; make an account the default or give one the prefix (s for settings)`,
    }
  const candidates = route.accounts
    .map((n) => ({
      account: config.accounts.find((a) => a.name === n),
      state: states.find((s) => s.account.name === n),
    }))
    .filter((c): c is { account: Account; state: AccountState | undefined } => !!c.account)
  const roomy = candidates.find((c) => hasRoom(c.state))
  if (roomy)
    return { account: roomy.account, route, reason: `first with room on ${route.prefix || '*'}` }
  const signedIn = candidates.find((c) => c.state?.auth?.loggedIn)
  if (signedIn)
    return {
      account: signedIn.account,
      route,
      reason: `every account on ${route.prefix || '*'} is near its limit`,
    }
  return { account: undefined, route, reason: `no account on ${route.prefix || '*'} is signed in` }
}
