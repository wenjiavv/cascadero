# Cascadero — rules digest and play handbook

Unofficial fan implementation of Reiner Knizia's *Cascadero*. You play through tool calls; nothing is hidden and
there is no luck after set-up, so every mistake is yours.

## Rules in short

- 2–4 players. Each has 30 envoys, a colour (blue / yellow / orange / pink) and one cube on each of the five
  success tracks (blue, yellow, orange, pink, white), all starting at 0.
- **A turn = place one envoy on an empty field.** Fields are hexes; towns are hexes too but nobody can stand on them.
- **Scoring a town.** The new envoy must be part of a *group* (two or more of your envoys connected edge to edge).
  For every town next to the NEW envoy that no other envoy of that same group already touches, advance your cube on
  the track of the town's colour:
  - 1 step if no envoy of any player stood next to that town before this placement,
  - 2 steps if somebody already did,
  - +1 step if a herald stands on the town.
- **A lone envoy scores nothing** — unless you spend a seal with it (`use_seal`), in which case it scores every
  town next to it by the same step rule.
- **A group scores each town only once, ever.** A town touched by a lone envoy counts as touched by the group that
  envoy later grows into, so that group will never score it. A *different* group of yours can still score it.
- **Tracks** (see `get_rules` topic `tracks` for the exact spaces): VP spaces (the first cube to arrive gets the
  bigger number), chain spaces (advance any cube 1), extra-turn spaces, seal spaces and two barriers.
  - VP / chain / extra turn trigger when passed or landed on.
  - A seal space only works if the cube **stops exactly on it**: take the seal if it is still there, otherwise you
    may move one of your envoys to an adjacent empty field.
  - Barriers (5 and 11): a cube can never stop there; an advance that would end on a barrier stops one space below.
    So a cube on 4 or 10 ignores every 1-step advance and needs a 2+ step advance to jump over.
- **Achievements.** Six unique ones, +3 VP to the first player only: a1 all five cubes ≥ 4, a2 hold 3 seals,
  a3 three cubes ≥ 10, a4 one group touching towns of all 5 colours, a5 a cube at 15, a6 one group touching 3 towns
  of one colour. Colour pairs: one group touching 2 towns of the same colour gives +2 VP, once per colour per
  player; all five colour pairs give another +10.
- **Back board only:** farmer slots hold face-up tiles (+2 VP, +3 VP, advance any cube 1, extra turn, move a
  herald). A slot is locked until you have an envoy on a neighbouring field; placing (or moving) an envoy onto it
  triggers the tile.
- **End.** The game ends at once when a player reaches 50 VP, or when a player has to move and has no envoy left.
- **Winner. Only players whose OWN-colour cube has reached 15 qualify.** Highest VP among the qualified wins (tie:
  whoever was later in the first-round turn order). If nobody qualified, highest VP wins a minor victory.

## How to drive the tools

1. `new_game` → you get the state and the first decision.
2. When it says *place an envoy*: call `list_moves` (try `filter="setup"` or `near="<town>"` too), optionally
   `inspect` a town or field, then `place_envoy`.
3. A placement can stop for sub-decisions: `choose_track` (chain / farmer advance), `move_envoy` (stopped on a
   seal space whose seal is gone), `move_herald` (farmer tile). Each accepts `skip=true`.
4. Every action returns what the opponents did and the next decision, so you rarely need `get_state`; ask for it
   with `include_map=true` when you want the picture.
5. `engine_advice` asks the built-in bot for its choice. `undo` takes back your last placement.
6. After the game, `save_postgame_notes` stores lessons; they come back in this handbook next time.

Coordinates are `"col,row"`. Do not guess adjacency from the ASCII map when it matters — `inspect` and
`list_moves` give exact neighbours and exact results.

## Playing well

1. **Qualify first.** 50 VP with your own cube below 15 is a loss against any qualified opponent. Count the steps
   you still need on your own colour and where they will come from. Own-colour towns are few: take them for 2 or 3
   steps (already visited, or with a herald), not for 1.
2. **Respect the barriers.** Do not let your own cube sit on 4 or 10 unless a 2+ step own-colour score is in
   sight. Chain advances and farmer advances are 1 step and cannot cross.
3. **Do not burn towns.** Starting a group with a lone envoy next to a town you want wastes that town for the
   whole group. Start one field away, then place the second envoy next to the town.
4. **Be the second visitor.** The first score on a town is 1 step, later ones 2. Let the opponent open towns and
   follow; avoid opening a town when the opponent can answer on it next turn for 2 (or 3 with the herald).
5. **Look for fields that touch two or three unscored towns** — one envoy, several advances.
6. **Count steps to land on seals.** Seals only come from stopping exactly on the seal space. A seal turns any lone
   envoy into a scoring move anywhere on the map, and holding 3 is an achievement. Taking the seal before the
   opponent also denies it.
7. **Several small groups beat one big snake** for track steps, because each group can score the same town again;
   one big group is what the group achievements (a4, a6, colour pairs, +10) want. Decide which you are doing.
8. **Watch the clock.** The game stops the moment someone hits 50. If you are qualified and ahead, rush VP. If the
   opponent is about to qualify and leads, deny the fields next to the towns of their colour — free fields next to
   a town are limited.
9. **Extra turns compound.** An extra turn taken just before a big scoring field, or to grab a contested field,
   is worth more than the space suggests.
