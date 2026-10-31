import { Text } from 'ink'

import { LOCAL_MODEL, type Local } from '../../../config.ts'
import { ago, resetShort } from '../../../format.ts'
import type { AccountState } from '../../../model.ts'
import { tildify } from '../../../paths.ts'
import { T } from '../../theme.ts'
import { sizeText } from '../Accounts.tsx'
import { Heading, Keys } from '../primitives.tsx'
import { row, title } from './parts.tsx'

export type AccountView = {
  state: AccountState
  routes: { prefix: string; rank: number }[]
  usageLines?: string[] | undefined
  now: number
}

// How an account's routes read: the empty prefix is the default for everything unnamed.
const routeWords = (routes: AccountView['routes']) =>
  routes.length
    ? routes
        .map((r) =>
          r.prefix === ''
            ? r.rank === 0
              ? 'default (anything no route names)'
              : `default, as choice ${r.rank + 1}`
            : `${r.prefix} as choice ${r.rank + 1}`,
        )
        .join(', ')
    : 'nothing yet: e to add prefixes'

// A local account: its server and model where a login shows its plan and limits.
function LocalDetail({ account, local }: { account: AccountView; local: Local }) {
  const { state } = account
  const a = state.account
  const status = state.auth?.local
  const c = state.counts
  const loaded = status?.loaded
  return (
    <>
      {title(`${a.name} · ${a.label}`)}
      <Text> </Text>
      {row(
        'model',
        status?.offline
          ? `${local.model} · disconnected: start Ollama to use it`
          : (status?.reason ?? `${local.model} · ready`),
        status?.offline ? T.dim : status && !status.reason ? T.text : T.waiting,
      )}
      {row('server', local.baseUrl)}
      {row('config', a.configDir ? tildify(a.configDir) : '')}
      {row('runs', `work whose model is ${LOCAL_MODEL}, ${local.concurrency} at a time unattended`)}
      {row(
        'memory',
        loaded
          ? `${sizeText(loaded.bytes)} · loaded with a ${loaded.context.toLocaleString()}-token window`
          : 'not loaded; the server loads it on first use',
      )}
      {loaded && loaded.context && loaded.context < local.context
        ? row(
            'window',
            `the server has ${loaded.context.toLocaleString()} tokens, but Claude Code is told ${local.context.toLocaleString()}: raise the server's or lower context in accounts.toml`,
            T.waiting,
          )
        : null}
      {row(
        'activity',
        `${c.queue} running · ${c.needs} waiting on you · ${c.done} archived · ${c.live} open terminals`,
      )}
      <Text> </Text>
      <Keys
        keys={[
          ['⏎', 'ask the server again'],
          ['r', 'rename'],
          ['d', 'remove'],
        ]}
      />
    </>
  )
}

export function AccountDetail({ account, width }: { account: AccountView; width: number }) {
  const { state, routes, now } = account
  const a = state.account
  if (a.local) return <LocalDetail account={account} local={a.local} />
  const u = state.usage
  const resets = [
    u?.fiveHour?.resetsAt ? `session ${resetShort(u.fiveHour.resetsAt, now)}` : null,
    u?.sevenDay?.resetsAt ? `week ${resetShort(u.sevenDay.resetsAt, now)}` : null,
  ].filter(Boolean)
  const c = state.counts
  return (
    <>
      {title(`${a.name} · ${a.label}`)}
      <Text> </Text>
      {row(
        'login',
        state.auth?.loggedIn
          ? [state.auth.email, state.auth.orgName, state.auth.subscriptionType]
              .filter(Boolean)
              .join(' · ')
          : 'not signed in',
        state.auth?.loggedIn ? T.text : T.waiting,
      )}
      {row(
        'config',
        a.configDir === null ? 'default login (CLAUDE_CONFIG_DIR unset)' : tildify(a.configDir),
      )}
      {row('runs', routeWords(routes))}
      {row(
        'activity',
        `${c.queue} running · ${c.needs} waiting on you · ${c.done} archived · ${c.live} open terminals`,
      )}
      {resets.length ? row('resets', resets.join(' · ')) : null}
      {state.sessionError
        ? row(
            'sessions',
            state.sessionsAt
              ? `${state.sessionError} · showing the list from ${ago(state.sessionsAt, now)} ago`
              : state.sessionError,
            T.blocked,
          )
        : null}
      <Text> </Text>
      <Heading label="limits" width={width} />
      {account.usageLines?.length ? (
        account.usageLines.map((l, i) => (
          <Text key={i} color={T.text} wrap="truncate-end">
            {l.replace(/^current /i, '').replace(/^\w/, (ch) => ch.toUpperCase())}
          </Text>
        ))
      ) : (
        <Text color={T.dim}>u refreshes usage</Text>
      )}
      {u ? <Text color={T.dim}>{`as of ${ago(u.fetchedAt, now)} ago`}</Text> : null}
      <Text> </Text>
      <Keys
        keys={[
          ['⏎', 'sign in'],
          ['u', 'usage'],
          ['e', 'prefixes'],
          ['1', 'make first'],
          ['*', 'make default'],
        ]}
      />
      <Text> </Text>
      <Keys
        keys={[
          ['a', 'add'],
          ['r', 'rename'],
          ['d', 'remove'],
        ]}
      />
    </>
  )
}
