import { isLocal, LOCAL_MODEL, type Account, type Config, type Route } from './config.ts'
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

// The accounts that may run work under `key` on `model`, in the order to try them. The model
// picks the kind: "local" runs only on local accounts (the route's, else every one, since nobody
// pays for them), anything else only on Claude logins. So Opus work never lands on the local
// model because the logins are full, and local work never falls back to a login. An account
// picked by hand is the only one, as long as it is the right kind for the model.
export function accountsFor(
  config: Config,
  key: string,
  model: string | undefined,
  chosen?: string,
): { names: string[]; route: Route | undefined; none: string } {
  const route = routeFor(config, key)
  if (chosen) {
    const a = config.accounts.find((x) => x.name === chosen)
    if (!a) return { names: [], route, none: `no account ${chosen}` }
    if (isLocal(a) !== (model === LOCAL_MODEL))
      return { names: [], route, none: `${chosen} doesn't run ${model ?? 'that model'}` }
    return { names: [chosen], route, none: '' }
  }
  if (model === LOCAL_MODEL) {
    const local = config.accounts.filter(isLocal).map((a) => a.name)
    const routed = route?.accounts.filter((n) => local.includes(n)) ?? []
    return { names: routed.length ? routed : local, route, none: 'no local account' }
  }
  const logins = config.accounts.filter((a) => !isLocal(a))
  // With a single login and no routes yet, there's nothing to choose: use it.
  const only = !route && logins.length === 1 ? logins[0] : undefined
  const names = (route?.accounts ?? (only ? [only.name] : [])).filter((n) =>
    logins.some((a) => a.name === n),
  )
  return { names, route, none: `no account runs ${key}` }
}

// Room means below these, on usage that is still current. Unknown or out-of-date usage counts
// as room: Hopper would rather try than stall on a guess. A local account has no usage; it is
// signed in while its server answers and has the model.
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

export function pickAccount(
  config: Config,
  key: string,
  states: AccountState[],
  model?: string,
  chosen?: string,
): Pick {
  const { names, route, none } = accountsFor(config, key, model, chosen)
  const local = model === LOCAL_MODEL
  if (!names.length)
    return {
      account: undefined,
      route,
      reason: chosen
        ? none
        : local
          ? `${none}; add one with provider = "ollama" in accounts.toml`
          : `${none}; make an account the default or give one the prefix (s for settings)`,
    }
  const where = local ? 'the local model' : route ? route.prefix || '*' : key
  const candidates = names
    .map((n) => ({
      account: config.accounts.find((a) => a.name === n),
      state: states.find((s) => s.account.name === n),
    }))
    .filter((c): c is { account: Account; state: AccountState | undefined } => !!c.account)
  // Picked by hand, or the only login with no routes yet: that one, full or not, if it can run.
  if (chosen || (!route && !local && candidates.length === 1)) {
    const only = candidates[0]!
    const why = only.state?.auth?.local?.reason ?? `${only.account.name} is not signed in`
    return only.state?.auth?.loggedIn
      ? { account: only.account, route, reason: chosen ? 'picked' : 'the only account' }
      : { account: undefined, route, reason: why }
  }
  const roomy = candidates.find((c) => hasRoom(c.state))
  if (roomy) return { account: roomy.account, route, reason: `first with room on ${where}` }
  const signedIn = candidates.find((c) => c.state?.auth?.loggedIn)
  if (signedIn)
    return {
      account: signedIn.account,
      route,
      reason: `every account on ${where} is near its limit`,
    }
  if (local) {
    const why = candidates.map((c) => c.state?.auth?.local?.reason).find(Boolean)
    return { account: undefined, route, reason: why ?? 'the local model is not running' }
  }
  return { account: undefined, route, reason: `no account on ${where} is signed in` }
}
