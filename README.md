# mini-ribbon

A cache-first fork of [robonuggets/ribbon](https://github.com/robonuggets/ribbon), a Claude Code mod.

It shows one slim row above the prompt with the state of your prompt cache:

- **WARM** (red, the robot bobs) with the **minutes left** before it goes cold.
- **COLD** (blue, the robot is frozen) with how long you've been idle and what the next message costs to re-cache.

Usage left in the 7-day and 5-hour windows still exists, but it sits behind a **Usage** button and is folded by default. **Details** opens the cache card (idle time, cached tokens, the next message's price on each model). It is folded by default whether the cache is warm or cold.

In a terminal, the band shows only the cache line as plain text, with no buttons.

## How it differs from ribbon

| | ribbon | mini-ribbon |
|---|---|---|
| Usage bars | always shown | behind **Usage**, folded |
| Cache card when cold | opens on its own | folded; **Details** opens it |
| Rows when folded | one or more, by width | always one |

## Install

```
claude plugin install mini-ribbon --marketplace tbergmen/mini-ribbon
```

Start a new session to see the band. If you have ribbon installed, uninstall it first (`claude plugin uninstall ribbon`) so you don't get two bands.

## Good to know

- **It costs nothing to run.** It reads the app's own numbers and draws them. It never calls a model.
- **Prices are estimates.** They come from the price table in `hooks/cache-art.ts` (`MODELS`), not from your bill.
- **Subagents don't count.** Only your main chat resets the cache clock.

## Remove it

```
claude plugin uninstall mini-ribbon
```

## Develop it

```
claude --plugin-dir ./mini-ribbon
claude plugin test ./mini-ribbon
```

## License

[MIT](LICENSE). The original ribbon is by Jay E from RoboLabs ([RoboNuggets](https://robonuggets.com)).

The embedded font is [Outfit](https://github.com/Outfitio/Outfit-Fonts), under the SIL Open Font License 1.1.
