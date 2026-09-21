# cascadero-mcp

An [MCP](https://modelcontextprotocol.io) server that lets an AI agent play full games of Cascadero against the
built-in bots — through text tool calls only: no screen capture, no vision model. It wraps the same headless rules
engine that the browser game and the private table server use, so every answer is validated by the real rules.

中文说明见 [README.zh-CN.md](README.zh-CN.md).

```
MCP client (Claude Code / Claude Desktop / Cursor / …)
        │  stdio, MCP tool calls
        ▼
mcp/src/index.mjs ── tools, resources, prompt
mcp/src/game.mjs  ── turn loop: parks on a pending decision for agent seats, validates, resumes; undo; saves to disk
mcp/src/view.mjs  ── position → text: summary, ASCII hex map, exact move facts, inspection, log lines
        │  require()
        ▼
online/engine.js  ── rules + the three bot levels (generated from ../index.html)
```

## Install

Needs Node.js 20+. From the repository root:

```bash
cd mcp && npm install
python3 ../online/build-engine.py     # generates online/engine.js; the server also does this itself when the file is missing or stale
```

Claude Code:

```bash
claude mcp add cascadero -- node /absolute/path/to/cascadero/mcp/src/index.mjs
```

Any other client, in its MCP configuration:

```json
{ "mcpServers": { "cascadero": { "command": "node", "args": ["/absolute/path/to/cascadero/mcp/src/index.mjs"] } } }
```

Then tell the agent: *"Play a game of Cascadero against the normal bot."* — or use the `cascadero_play` prompt.

| Environment variable | Meaning |
|---|---|
| `CASC_MCP_DATA` | where games, the game log and post-game notes are stored (default `~/.cascadero-mcp`) |
| `CASC_MCP_LANG` | `en` (default) or `zh`: language of game-log lines and of the handbook |
| `CASC_ENGINE` | path to an `engine.js` to use instead of `../online/engine.js` |

## Tools

| Tool | What it does |
|---|---|
| `new_game` | seats (`agent` / `easy` / `normal` / `hard`, 2–4), board (`front` / `back`), first player, colours, herald set, language |
| `get_state` | full position, what happened since the last call, the pending decision; optional ASCII map |
| `list_moves` | legal placements with exact facts: adjacent towns, which towns score and for how many steps, the exact result under the real rules (cube steps, VP itemised by source, seals, extra turns, whether it ends the game), farmer tile, what a quiet move sets up; `filter` = `scoring` / `setup` / `all`, `near` = a town or field |
| `inspect` | exact neighbourhood of a town or field; for an envoy, its group and the towns that group can no longer score |
| `place_envoy` | the main move (`field`, optional `use_seal`) |
| `choose_track` | answer "advance any cube 1" (chain space or farmer tile) |
| `move_envoy` | answer "the seal is gone, you may move an envoy" |
| `move_herald` | answer the farmer tile "move a herald" |
| `engine_advice` | what the built-in bot (normal / hard) would answer right now |
| `undo` | take back your last placement; the bots replay |
| `list_games` | saved games; pass an id as `game_id` to resume an unfinished one |
| `get_rules` | `handbook` (rules digest + tool guide + strategy + saved lessons), `tracks`, `board_front`, `board_back` |
| `save_postgame_notes` | store lessons from a game; the latest five are appended to the handbook |

Every action returns the consequences, the opponents' replies and the next decision, so an agent plays a whole
game as a plain loop of *look → decide → act*. Illegal answers come back as tool errors that say why (town cell,
occupied, locked farmer slot, seal has no effect there, cube under a barrier, wrong kind of decision, …) and
change nothing.

Resources: `cascadero://handbook`, `cascadero://handbook/zh`, `cascadero://tracks`, `cascadero://board/front`,
`cascadero://board/back`, `cascadero://postgame/{name}`. Prompt: `cascadero_play` (`opponent`, `board`, `lang`).

## Notes

- Several seats may be `agent`: the pending decision always names the seat, so one agent can play both sides or
  two agents can share a game.
- Finished games are appended to `gamelog.jsonl` in the same shape as the table server's log (opening snapshot +
  decision list), so they can feed the same analysis scripts.
- The engine keeps the active board in module state; the server therefore runs one tool call at a time.
- The "result" shown by `list_moves` comes from running the real turn on a copy of the position, so achievements and
  colour pairs that are already claimed are never promised again. The quick simulator is only used for sorting.
- `npm test` plays three complete games over the real protocol with a scripted client and checks illegal
  answers, undo, post-game notes and resuming after a restart. `node test/fuzz.mjs` throws random legal and junk
  answers, skips and undos at the session layer for a few dozen games.

This is an unofficial fan project; see the repository's NOTICE.md.
