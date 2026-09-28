import { Text } from 'ink'

import { ago, resetShort } from '../../../format.ts'
import type { AccountState } from '../../../model.ts'
import { tildify } from '../../../paths.ts'
import { T } from '../../theme.ts'
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

export function AccountDetail({ account, width }: { account: AccountView; width: number }) {
  const { state, routes, now } = account
  const a = state.account
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
        `${c.queue} running · ${c.needs} waiting on you · ${c.done} done · ${c.live} open terminals`,
      )}
      {resets.length ? row('resets', resets.join(' · ')) : null}
      {state.sessionError ? row('sessions', state.sessionError, T.blocked) : null}
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
