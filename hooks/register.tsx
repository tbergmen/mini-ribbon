import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CacheFacts, Fold, Window } from '../types'
import {
  BG, EMPTY, HUE, INK, MUTED, ORANGE, ROBO_SIZE, TEXT, TTL_MIN, TTL_MS, WORD, YELLOW,
  bandPx, cardSvg, chipSvg, costOf, familyOf, fmtIdle, kindOf, mineModel, roboSvg, usd,
} from './cache-art'
import type { CacheView } from './cache-art'

// A one-row band above the prompt, cache first. After the first reply it shows
// the prompt cache: WARM (red, Robo bobbing) with the minutes left for an hour
// after the last request, then COLD (blue, Robo frozen) with how long it has been
// idle and what the next message costs to re-cache. Details opens the cache card,
// folded by default in both states.
//
// Usage left (7-day orange, 5-hour yellow, a bold LOW under 15%) sits behind a
// Usage button, folded by default, because it is rarely worth a row in every
// session. Zero token cost: it reads the engine's own figures and draws.

const CELLS = 10
const LOW_AT = 15
const TIGHT_CELLS = 6
/** How often the band redraws, so the countdown and the warm-to-cold flip stay current. */
const TICK_MS = 30_000

const windows = atom({ plugin: 'mini-ribbon', key: 'windows' } as const, [] as Window[])
const cache = atom({ plugin: 'mini-ribbon', key: 'cache' } as const, null as CacheFacts | null)
const fold = atom({ plugin: 'mini-ribbon', key: 'fold' } as const, null as Fold | null)
const usageShown = atom({ plugin: 'mini-ribbon', key: 'usageShown' } as const, false as boolean)

const NAMES: Record<string, string> = { seven_day: '7D', five_hour: '5H', spend_limit: 'SPEND' }
const ORDER: Record<string, number> = { seven_day: 0, five_hour: 1 }
const COLORS: Record<string, string> = { seven_day: ORANGE, five_hour: YELLOW }

const clean = (list: readonly Window[]): Window[] =>
  list
    .map(w => ({ kind: w.kind, percentUsed: w.percentUsed, resetsAt: w.resetsAt }))
    .sort((a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9))

const dots = (left: number, cells: number): { on: string; off: string } => {
  const n = Math.max(0, Math.min(cells, Math.round((left / 100) * cells)))
  return { on: '●'.repeat(n), off: '·'.repeat(cells - n) }
}

const fmtReset = (iso: string | undefined, now: number): string => {
  if (!iso) return ''
  const ms = Date.parse(iso) - now
  if (Number.isNaN(ms)) return ''
  if (ms <= 0) return 'resetting'
  const mins = Math.round(ms / 60000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ${mins % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

/** What the cache drawings read, or null until a request and its context size are known. */
export const viewOf = (c: CacheFacts | null, now: number): CacheView | null => {
  if (!c || c.lastAt <= 0 || c.tokens <= 0) return null
  const idleMs = Math.max(0, now - c.lastAt)
  return {
    mode: idleMs >= TTL_MS ? 'cold' : 'warm',
    idle: fmtIdle(idleMs),
    idleMin: Math.floor(idleMs / 60000),
    tokens: c.tokens,
    window: c.window,
    mine: familyOf(c.model),
  }
}

const pull = async ($: EngineInterface): Promise<void> => {
  const u = await $.session.usage()
  await update($, windows, () => clean(u.rateLimits))
}

/** Fresh context figures from the engine onto the cache facts, when it has them. */
const measure = async ($: EngineInterface, lastAt: number | null, model: string | null): Promise<void> => {
  const u = await $.session.usage()
  const m = model ?? (await $.session.model())
  await update($, cache, c => ({
    lastAt: lastAt ?? c?.lastAt ?? 0,
    tokens: u.context.tokens && u.context.tokens > 0 ? u.context.tokens : (c?.tokens ?? 0),
    window: u.context.window || c?.window || 0,
    model: m || c?.model || null,
  }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await pull($)
    $.clock.every(TICK_MS, () => $.ui.invalidate('ui.render'))
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await update($, windows, () => clean(e.rateLimits))
    }
    if (e.changed.includes('context') && e.context.tokens && e.context.tokens > 0) {
      const tokens = e.context.tokens
      await update($, cache, c => (c ? { ...c, tokens, window: e.context.window || c.window } : c))
    }
    return next(e)
  })

  // A resumed or forked session knows how long it was away and how big it is.
  on('classic.SessionStart', async ($, e, next) => {
    const r = await next(e)
    if (e.source === 'clear' || e.source === 'compact') {
      await update($, cache, () => null)
      await update($, fold, () => null)
    } else if ((e.source === 'resume' || e.source === 'fork') && typeof e.seconds_since_last_response === 'number') {
      const now = await $.clock.now()
      const lastAt = now - e.seconds_since_last_response * 1000
      const window = (await $.session.usage()).context.window
      const model = typeof e.model === 'string' ? e.model : await $.session.model()
      const tokens = typeof e.context_tokens === 'number' ? e.context_tokens : 0
      await update($, cache, () => ({ lastAt, tokens, window, model }))
    }
    return r
  }).catch(($, e, next) => next(e)) // a band that fails to seed never holds up the session

  // Each main-thread request reads or writes the cache, so its start resets the hour.
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) {
      const now = await $.clock.now()
      await update($, cache, c => ({ lastAt: now, tokens: c?.tokens ?? 0, window: c?.window ?? 0, model: c?.model ?? null }))
    }
    yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r
    const now = await $.clock.now()
    const c = await read($, cache)
    // turn.step stamps the exact request time; when no step of this turn did, the turn's end is the floor.
    const lastAt = !c || now - c.lastAt > e.durationMs ? now : c.lastAt
    await measure($, lastAt, e.usage?.model ?? null)
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    // Svg draws on desktop, mobile and VS Code; the terminal gets the text form.
    // Ask the surface, not the table: the terminal's table still lists Svg.
    const Svg = e.surface !== 'terminal' && 'Svg' in ui ? ui.Svg : null
    const list = await read($, windows)
    const now = await $.clock.now()
    const view = viewOf(await read($, cache), now)

    const columns = e.props.bodyColumns ?? e.viewport?.columns ?? 100
    const kind = kindOf(columns)
    const isWide = kind === 'wide'
    const cells = kind === 'tight' ? TIGHT_CELLS : CELLS

    const parts = (w: Window) => {
      const left = Math.max(0, Math.round((100 - w.percentUsed) * 10) / 10)
      return {
        left,
        col: COLORS[w.kind] ?? TEXT,
        name: NAMES[w.kind] ?? w.kind.toUpperCase(),
        d: dots(left, cells),
        reset: fmtReset(w.resetsAt, now),
      }
    }

    // Wide: every window on one row. Narrow: each window is a block of three
    // lines (name and dots, percent left, reset time) so nothing wraps or clips.
    const wide = (w: Window, i: number) => {
      const p = parts(w)
      return (
        <Box key={`w-${i}`} flexDirection="row" flexShrink={0} marginRight={3}>
          <Text color={MUTED} bold>{p.name} </Text>
          <Text color={p.col}>{p.d.on}</Text>
          <Text color={EMPTY}>{p.d.off}</Text>
          <Text color={p.col} bold> {p.left}% left</Text>
          {p.left < LOW_AT ? <Text color={TEXT} bold> LOW</Text> : null}
          {p.reset ? <Text color={MUTED}> · {p.reset}</Text> : null}
        </Box>
      )
    }

    const stacked = (w: Window, i: number) => {
      const p = parts(w)
      return (
        <Box key={`w-${i}`} flexDirection="column" flexShrink={0} marginRight={3}>
          <Box flexDirection="row">
            <Text color={MUTED} bold>{p.name} </Text>
            <Text color={p.col}>{p.d.on}</Text>
            <Text color={EMPTY}>{p.d.off}</Text>
          </Box>
          <Box flexDirection="row">
            <Text color={p.col} bold>{p.left}% left</Text>
            {p.left < LOW_AT ? <Text color={TEXT} bold> LOW</Text> : null}
          </Box>
          {p.reset ? <Text color={MUTED}>resets {p.reset}</Text> : null}
        </Box>
      )
    }

    // Usage is folded away by default and only reachable by its button, which
    // the terminal does not get: there the band is the cache line alone.
    const usageOpen = Svg !== null && (await read($, usageShown))
    const usageButton = Svg ? (
      <Box key="usage" flexShrink={0} alignItems="flex-start" marginRight={1}>
        <Button key="usage-fold" label={usageOpen ? 'Hide usage' : 'Usage'} onPress={() => update($, usageShown, v => !v)} />
      </Box>
    ) : null
    const usageRow = usageOpen ? (
      <Box key="usage-row" flexDirection="row" paddingX={1}>
        {list.length > 0
          ? list.map(isWide ? wide : stacked)
          : <Text color={MUTED}>USAGE · waiting for the first reading</Text>}
      </Box>
    ) : null
    const grow = <Box key="grow" flexGrow={1} />

    // Before the first reply there is no cache to show yet.
    if (!view) {
      return (
        <Box flexDirection="column" backgroundColor={BG}>
          <Box key="row" flexDirection="row" paddingX={1} alignItems="center">
            <Text color={MUTED}>CACHE · waiting for the first reply</Text>
            {grow}
            {usageButton}
          </Box>
          {usageRow}
        </Box>
      )
    }

    const mode = view.mode
    const cold = mode === 'cold'
    const hue = HUE[mode]
    const mine = mineModel(view)
    const stored = await read($, fold)
    // The card is a drawing, so the terminal stays folded; elsewhere it starts
    // folded in both states and a choice holds until the cache flips.
    const open = Svg !== null && stored !== null && stored.mode === mode && stored.open
    const toggle = () =>
      update($, fold, f => ({ mode, open: !(f !== null && f.mode === mode && f.open) }))

    const badge = Svg
      ? [
          <Svg key="robo" source={roboSvg(mode)} alt={cold ? 'Robo, frozen' : 'Robo, bobbing'} width={ROBO_SIZE} height={ROBO_SIZE} isInteractive />,
          <Text key="gap"> </Text>,
          (() => {
            const c = chipSvg(mode)
            return <Svg key="chip" source={c.source} alt={WORD[mode]} width={c.w} height={c.h} />
          })(),
        ]
      : [<Text key="chip" backgroundColor={hue} color={INK} bold>{` ${WORD[mode]} `}</Text>]

    const summary = cold
      ? [
          <Text key="idle" color={hue} bold>{` ${view.idle}`}</Text>,
          mine ? <Text key="dot" color={MUTED}> · </Text> : null,
          mine ? <Text key="cost" color={TEXT} bold>{usd(costOf(mine, mode, view.tokens))}</Text> : null,
        ]
      : [<Text key="left" color={hue} bold>{` ${Math.max(0, TTL_MIN - view.idleMin)}m left`}</Text>]

    const cardButton = Svg ? (
      <Box key="fold" flexShrink={0} alignItems="flex-start">
        <Button key="cache-fold" label={open ? 'Hide' : 'Details'} onPress={toggle} />
      </Box>
    ) : null

    let card = null
    if (open && Svg) {
      const c = cardSvg(view, kind, bandPx(columns))
      card = (
        <Box key="card" flexDirection="row">
          <Svg source={c.source} alt={c.alt} width={c.w} height={c.h} isInteractive={kind !== 'tight'} />
        </Box>
      )
    }

    return (
      <Box flexDirection="column" backgroundColor={BG}>
        <Box key="row" flexDirection="row" paddingX={1} alignItems="center">
          {badge}
          {summary}
          {grow}
          {usageButton}
          {cardButton}
        </Box>
        {usageRow}
        {card}
      </Box>
    )
  })
}
