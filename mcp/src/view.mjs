// Everything the agent reads: state summary, ASCII map, move facts, field/town inspection, log text.
// Labels are English; game-log lines and "why" texts come from the engine's own dictionary in the game's language.
import { E } from './engine.mjs';
import { HINT } from './game.mjs';

const strip = (s) => String(s).replace(/<[^>]*>/g, '');
const LETTER = { blue: 'B', yellow: 'Y', orange: 'O', pink: 'P', white: 'W' };
const TILE = { vp2: 'f2', vp3: 'f3', adv: 'fa', envoy: 'fe', herald: 'fh' };
const TILE_TEXT = { vp2: '+2 VP', vp3: '+3 VP', adv: 'advance any cube 1', envoy: 'extra turn', herald: 'move a herald' };
const ACH = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
const board = (st) => E.setBoard(st.boardId || 'front');

export const logLine = (g, l) => strip(l.k ? E.tr(l.k, l.a, g.cfg.lang) : (l.m || ''));
export const whyText = (g, why) => why && why.k ? strip(E.tr(why.k, why.a, g.cfg.lang)) : '';

/* ---------- tracks ---------- */
function spaceText(sp){
  if (!sp) return 'empty';
  const t = [];
  if (sp.x) t.push('BARRIER');
  if (sp.vp) t.push(sp.vp.length > 1 ? `VP ${sp.vp[0]} (first cube) / ${sp.vp[1]} (later)` : `VP ${sp.vp[0]}`);
  if (sp.seal) t.push('seal');
  if (sp.adv) t.push('chain: advance any cube 1');
  if (sp.envoy) t.push('extra turn');
  if (sp.ach) t.push(`banner ${sp.ach}`);
  return t.join(' + ');
}
export function tracksText(){
  const lines = ['Success tracks (one per town colour, spaces 0-15, every player has one cube on each):'];
  const defs = E.TRACK_COLORS.map(c => JSON.stringify(E.trackDef(c)));
  const groups = {}; E.TRACK_COLORS.forEach((c, i) => { (groups[defs[i]] = groups[defs[i]] || []).push(c); });
  for (const cs of Object.values(groups)){
    lines.push(`\n${cs.join(' / ')}:`);
    const def = E.trackDef(cs[0]);
    for (let p = 1; p <= E.TOP; p++) if (def[p]) lines.push(`  ${String(p).padStart(2)}: ${spaceText(def[p])}`);
  }
  lines.push('', 'VP, chain and extra-turn spaces pay out when your cube passes or stops on them. A seal space only works when the cube STOPS exactly on it: if the seal is still there you take it, if it is gone you may move one of your envoys to an adjacent empty field instead.',
    'BARRIER (5 and 11): a cube can never stop there. An advance that would end on a barrier stops one space below, so a cube on 4 or 10 ignores 1-step advances entirely and needs a 2+ step advance to jump over.');
  return lines.join('\n');
}
function nextOnTrack(st, pl, c){
  const def = E.trackDef(c), pos = pl.cubes[c]; if (pos >= E.TOP) return 'at the top';
  const out = [];
  for (let p = pos + 1; p <= Math.min(E.TOP, pos + 3); p++){
    const sp = def[p]; let t = sp ? spaceText(sp) : '-';
    if (sp && sp.seal) t = st.tracks[c].sealTaken[p] ? 'seal (taken → move an envoy)' : 'seal (available)';
    if (sp && sp.vp && sp.vp.length > 1) t = st.tracks[c].firstVP[p] ? `VP ${sp.vp[1]}` : `VP ${sp.vp[0]} (first)`;
    out.push(`${p}:${t}`);
  }
  const warn = def[pos + 1] && def[pos + 1].x ? 'UNDER A BARRIER, 1-step advances do nothing, needs a 2+ step score | ' : def[pos + 2] && def[pos + 2].x ? 'a 2-step advance would stop at ' + (pos + 1) + ' under the barrier | ' : '';
  return warn + out.join(', ');
}

/* ---------- state ---------- */
export function stateText(g, { map = false, events = true } = {}){
  const st = g.st; board(st); const L = [];
  const p = g.pending; const viewer = p ? p.seat : null;
  L.push(`Game ${g.id} | board: ${st.boardId} | turn ${st.turn.num}${st.turn.extra ? ` (+${st.turn.extra} extra turn queued)` : ''} | ${st.ended ? 'GAME OVER' : `to move: seat ${st.turn.player} (${st.players[st.turn.player].name})`}`);
  L.push('', 'Players:');
  st.players.forEach((pl, i) => {
    const own = pl.cubes[pl.color];
    const pairs = E.TRACK_COLORS.filter(c => pl.teal[c]), open = E.TRACK_COLORS.filter(c => !pl.teal[c]);
    L.push(`  [seat ${i}] ${pl.name}${g.isAgent(i) ? ' (agent)' : ''}${i === viewer ? ' <- YOU decide now' : ''} | colour ${pl.color} | VP ${pl.vp} | envoys left ${pl.envoys} | seals ${pl.seals}`);
    L.push(`      cubes: ${E.TRACK_COLORS.map(c => `${c} ${pl.cubes[c]}`).join(', ')} | own track (${pl.color}) ${own}/${E.TOP} ${own >= E.TOP ? 'QUALIFIED to win' : 'not qualified yet'}| colour pairs (+2 each, once per colour): done ${pairs.join(', ') || 'none'}${pl.tealAll ? ' (all five, +10 taken)' : `, still open ${open.join(', ')}`}`);
  });
  const lead = Math.max(...st.players.map(pl => pl.vp)), fewest = Math.min(...st.players.map(pl => pl.envoys));
  L.push('', `End clock: leader has ${lead}/50 VP; fewest envoys left = ${fewest} (the game also ends when a player with 0 envoys has to move). Qualified so far: ${st.players.filter(pl => pl.cubes[pl.color] >= E.TOP).map(pl => pl.name).join(', ') || 'nobody'}.`);
  L.push(`Heralds stand on towns: ${st.heralds.map(t => `${t} (${E.town()[t].color})`).join(', ') || 'none'}  (a town with a herald gives +1 step)`);
  const open = ACH.filter(a => st.unique[a] === null), taken = ACH.filter(a => st.unique[a] !== null);
  L.push(`Unique achievements (+3 VP, first player only): open: ${open.map(a => `${a}=${strip(E.tr('ach.' + a, null, 'en'))}`).join('; ') || 'none'}${taken.length ? ` | claimed: ${taken.map(a => `${a} by seat ${st.unique[a]}`).join(', ')}` : ''}`);
  if (viewer !== null){
    const pl = st.players[viewer];
    L.push('', `Your next track spaces (seat ${viewer}):`);
    for (const c of E.TRACK_COLORS) L.push(`  ${c}${c === pl.color ? ' (OWN)' : ''} at ${pl.cubes[c]} -> ${nextOnTrack(st, pl, c)}`);
  }
  if (events){ const ev = g.newEvents(); if (ev.length){ L.push('', 'What happened since your last call:'); ev.forEach(l => L.push('  ' + logLine(g, l))); } }
  if (g.saveError) L.push('', saveWarning(g));
  L.push('', st.ended ? resultText(g) : pendingText(g));
  if (map) L.push('', mapText(st));
  return L.join('\n');
}

export function pendingText(g){
  const p = g.pending, st = g.st; if (!p) return 'No decision is pending.';
  const head = `DECISION NEEDED from seat ${p.seat} (${st.players[p.seat].name}): `;
  if (p.kind === 'place') return head + `place an envoy. ${st.players[p.seat].envoys} left${st.players[p.seat].seals ? `, ${st.players[p.seat].seals} seal(s) in hand` : ''}. Use list_moves to see options, then place_envoy.`;
  if (p.kind === 'cube') return head + `${whyText(g, p.why)}\n  Options: ${p.opts.map(o => `${o.value} ${o.pos}->${o.blocked ? (o.top ? 'top, unavailable' : 'blocked by barrier, unavailable') : o.to + ' [' + (spaceText(E.trackDef(o.value)[o.to]) || 'empty') + ']' + ((E.trackDef(o.value)[o.to + 1] || {}).x ? ' WARNING: then stuck under the barrier until a 2+ step score on this colour' : '')}`).join(' | ')}\n  ${HINT.cube}`;
  if (p.kind === 'move'){
    const mine = Object.keys(st.board).filter(k => st.board[k].p === p.seat).map(k => ({ k, to: E.ff()[k].filter(n => !st.board[n]) })).filter(x => x.to.length);
    return head + `${whyText(g, p.why)}\n  Movable envoys -> empty neighbours: ${mine.map(x => `${x.k} -> ${x.to.join(' ')}`).join(' | ')}\n  A moved envoy scores nothing by itself (it only changes your shape; moving onto a farmer tile triggers the tile). ${HINT.move}`;
  }
  if (p.kind === 'herald') return head + `${whyText(g, p.why)}\n  Heralds now on: ${p.opts.from.join(', ')} | valid destinations: ${p.opts.to.map(t => `${t}(${E.town()[t].color})`).join(' ')}\n  ${HINT.herald}`;
  return head + p.kind;
}

export function resultText(g){
  const st = g.st, r = st.result; if (!r) return 'GAME OVER';
  const L = [`GAME OVER (${r.reason === 'vp' ? 'someone reached 50 VP' : 'a player ran out of envoys'}). Winner: seat ${r.winner} ${st.players[r.winner].name}${r.minor ? ' (nobody qualified, decided on VP alone)' : ''}`];
  r.ranking.forEach((q, n) => L.push(`  ${n + 1}. seat ${q.i} ${st.players[q.i].name}: ${q.vp} VP, own track ${st.players[q.i].cubes[st.players[q.i].color]}/${E.TOP}${q.qual ? ' qualified' : ' NOT qualified'}`));
  L.push('If you learned something worth remembering for the next game, record it with save_postgame_notes.');
  return L.join('\n');
}

/* ---------- compact reply after an action ---------- */
export function afterText(g, lead){
  const st = g.st; board(st); const L = []; if (lead) L.push(lead);
  const ev = g.newEvents(); if (ev.length){ L.push('Events:'); ev.forEach(l => L.push('  ' + logLine(g, l))); }
  L.push('Score: ' + st.players.map((pl, i) => `[${i}] ${pl.name} ${pl.vp} VP, own ${pl.cubes[pl.color]}/${E.TOP}, envoys ${pl.envoys}, seals ${pl.seals}`).join(' | ') + ` | turn ${st.turn.num}`);
  if (g.saveError) L.push(saveWarning(g));
  L.push('', st.ended ? resultText(g) : pendingText(g));
  return L.join('\n');
}
const saveWarning = (g) => `WARNING: this turn could not be saved to disk (${g.saveError}); after a restart the game may fall back to the last turn that was saved.`;

/* ---------- map ---------- */
// Flat-top hexes in vertical columns; odd columns sit half a cell higher, so each text line holds one parity only.
export function mapText(st){
  board(st); const cells = Object.keys(E.nb()).map(k => k.split(',').map(Number));
  const cmax = Math.max(...cells.map(c => c[0])), cmin = Math.min(...cells.map(c => c[0]));
  const glyph = (k) => { const t = E.town()[k]; if (t) return LETTER[t.color] + (st.heralds.includes(k) ? '!' : ' ');
    const e = st.board[k]; if (e) return e.p + (e.seal ? 's' : ' ');
    if (E.farmer().has(k)) return TILE[st.farmerTiles[k]] || 'f?';
    return '. '; };
  const rows = new Map();   // line number = 2*row for even columns, 2*row-1 for odd columns
  for (const [c, r] of cells){ const y = c % 2 ? 2 * r - 1 : 2 * r; if (!rows.has(y)) rows.set(y, {}); rows.get(y)[c] = glyph(c + ',' + r); }
  const L = ['Map ("col,row" coordinates; columns run top to bottom, odd columns are shifted half a cell up):',
    'Legend: B/Y/O/P/W = town of that colour ("!" = herald on it), digit = envoy of that seat ("s" = placed with a seal), "." = empty field' + (E.farmer().size ? ', f2/f3 = farmer +2/+3 VP, fa = advance a cube, fe = extra turn, fh = move a herald (farmer slots unlock when you have an envoy next to them)' : ''),
    'col   ' + Array.from({ length: cmax - cmin + 1 }, (_, i) => String(cmin + i).padEnd(3)).join('')];
  for (const y of [...rows.keys()].sort((a, b) => a - b)){
    const odd = y % 2 === 1, r = odd ? (y + 1) / 2 : y / 2; let s = `r${String(r).padStart(2)}${odd ? "'" : ' '}  `;
    for (let c = cmin; c <= cmax; c++) s += (rows.get(y)[c] || '  ').padEnd(3);
    L.push(s.trimEnd());
  }
  L.push("(lines marked ' hold the odd columns.) Neighbours of an even-column cell c,r: c,r-1 c,r+1 c-1,r c-1,r+1 c+1,r c+1,r+1; of an odd-column cell: c,r-1 c,r+1 c-1,r-1 c-1,r c+1,r-1 c+1,r. Use inspect for exact neighbours.");
  return L.join('\n');
}

/* ---------- moves ---------- */
// Exact result of one placement: run the real turn on a copy (chain advances answered by the engine's simple rule,
// optional envoy / herald moves skipped). The quick simulator used for sorting only approximates achievements.
const SIM_DECIDE = (key, seal) => ({ choosePlacement: async () => ({ key, seal }), chooseCube: async (s, pi) => E.botPickCube(s, pi), chooseMove: async () => null, chooseHerald: async () => null });
export async function exact(base, st, pi, key, seal){
  const s = JSON.parse(base); await E.runTurn(s, SIM_DECIDE(key, seal)); board(st);
  const pl = st.players[pi], p2 = s.players[pi]; const adv = {};
  for (const c of E.TRACK_COLORS){ const d = p2.cubes[c] - pl.cubes[c]; if (d > 0) adv[c] = d; }
  const why = [];
  for (const l of s.log){
    if (l.k === 'log.cellVP') why.push(`${l.a.c} track ${l.a.p}: ${l.a.gain}`);
    else if (l.k === 'log.achUnique') why.push(`achievement ${l.a.id}: 3`);
    else if (l.k === 'log.achPair') why.push(`${l.a.c} colour pair: 2`);
    else if (l.k === 'log.achAll') why.push('all five colour pairs: 10');
    else if (l.k === 'log.farmer' && (l.a.t === 'vp2' || l.a.t === 'vp3')) why.push(`farmer tile: ${l.a.t === 'vp2' ? 2 : 3}`);
  }
  const outOfEnvoys = !s.ended && s.players[s.turn.player].envoys <= 0;                              // runTurn ends the game as soon as a player with no envoy has to move
  const stays = !s.ended && !outOfEnvoys && s.turn.player === pi && s.turn.num === st.turn.num;
  return { adv, vp: p2.vp - pl.vp, why, seals: p2.seals - pl.seals + (seal ? 1 : 0), extra: outOfEnvoys ? 0 : s.turn.extra - st.turn.extra + (stays ? 1 : 0), ends: s.ended || outOfEnvoys, after: s };
}
function quick(st, pi, key, seal){
  const ev = E.evalPlacement(st, key, pi, seal), r = E.simEval(st, pi, key, seal, 3);
  return { key, seal, score: r.score, single: ev.single, size: ev.group.size, scorings: ev.scorings, tile: E.farmer().has(key) ? st.farmerTiles[key] : null };
}
async function enrich(base, st, pi, f){
  const x = await exact(base, st, pi, f.key, f.seal); const ev = { scorings: f.scorings };
  f.towns = (E.ft()[f.key] || []).map(t => { const tt = E.town()[t]; const sc = ev.scorings.find(q => q.town === t);
    return `${t} ${tt.color}${st.heralds.includes(t) ? '+herald' : ''}${sc ? ` SCORES ${sc.steps}` : f.single ? ' (no score: a lone envoy scores nothing, and the group it grows into cannot score this town while this envoy stays next to it)' : ' (no score: the group you join already touches it)'}`; });
  // what a quiet placement would set up: the best scoring follow-up on a neighbouring empty field
  f.follow = null;
  if (!f.scorings.length && !x.ends){ let best = 0;
    for (const n of E.ff()[f.key]){ if (x.after.board[n]) continue; const e2 = E.evalPlacement(x.after, n, pi, false); const steps = e2.scorings.reduce((a, q) => a + q.steps, 0);
      if (steps > best){ best = steps; f.follow = `${n} would then score ${e2.scorings.map(q => `${q.color} ${q.steps}`).join(' + ')}`; } } }
  return Object.assign(f, { adv: x.adv, vp: x.vp, why: x.why, seals: x.seals, extra: x.extra, ends: x.ends });
}
export const simBase = (st) => JSON.stringify({ ...st, log: [], fx: null });
function factLine(f){
  const bits = [`${f.key}${f.seal ? ' +SEAL' : ''}`];
  bits.push(f.single ? 'lone envoy' : `joins your group (size ${f.size})`);
  if (f.towns.length) bits.push('towns: ' + f.towns.join('; ')); else bits.push('no town adjacent');
  if (f.tile) bits.push(`farmer tile: ${TILE_TEXT[f.tile]}`);
  const gain = [];
  if (Object.keys(f.adv).length) gain.push('cubes ' + Object.entries(f.adv).map(([c, d]) => `${c}+${d}`).join(' '));
  if (f.vp) gain.push(`VP +${f.vp} (${f.why.join(', ')})`); if (f.seal) gain.push(`seals: 1 spent${f.seals > 0 ? `, ${f.seals} gained` : ''}`); else if (f.seals > 0) gain.push(`seal +${f.seals}`); if (f.extra > 0) gain.push(`extra turn +${f.extra}`); if (f.ends) gain.push('ENDS THE GAME');
  if (!gain.length && f.scorings.length) gain.push('nothing: the cube on that track is at the top or stuck under a barrier');
  bits.push(gain.length ? 'result: ' + gain.join(', ') : 'no immediate gain');
  if (f.follow) bits.push('sets up: ' + f.follow);
  bits.push(`h=${f.score.toFixed(1)}`);
  return '  ' + bits.join(' | ');
}
export async function movesText(g, { filter = 'scoring', near = null, limit = 15, first = null } = {}){
  const st = g.st, p = g.pending; board(st);
  if (!p || p.kind !== 'place') return p ? `No placement to make right now. ${pendingText(g)}` : 'No decision is pending.';
  const pi = p.seat, pl = st.players[pi]; let legal = E.legalFields(st, pi);
  if (near){ if (!E.nb()[near]) return `"${near}" is not a cell of this board.`; const ring = new Set([near, ...E.nb()[near]]); for (const k of [...ring]) (E.nb()[k] || []).forEach(n => ring.add(n)); legal = legal.filter(k => ring.has(k)); }
  let all = [];
  for (const k of legal){ all.push(quick(st, pi, k, false)); if (pl.seals > 0 && E.canUseSealHere(st, k, pi)) all.push(quick(st, pi, k, true)); }
  const base = simBase(st); for (const f of all) await enrich(base, st, pi, f);                       // ~0.4 ms each
  const hot = (f) => Object.keys(f.adv).length > 0 || f.vp > 0 || f.extra > 0 || f.seals > 0 || f.tile === 'herald' || f.ends;   // judged on the exact result: a scoring whose cube is blocked is not an effect; a quiet-looking join that completes an achievement is
  const scoring = all.filter(hot), quiet = all.filter(f => !hot(f));
  let pick = filter === 'all' || near ? all : filter === 'setup' ? quiet : scoring;
  if (!pick.length && filter === 'scoring'){ pick = quiet; filter = 'setup'; }
  pick.sort((a, b) => b.score - a.score);
  if (first){ const i = pick.findIndex(f => f.key === first.key && f.seal === !!first.seal); if (i > 0) pick.unshift(pick.splice(i, 1)[0]); }   // engine_advice: its choice on top
  pick = pick.slice(0, limit);
  const L = [`Legal placements for seat ${pi} (${pl.name}): ${legal.length} fields${near ? ` within 2 of ${near}` : ''}; ${scoring.length} options have an immediate effect (cube steps, VP, seal, extra turn or farmer tile), ${quiet.length} are quiet.`,
    `Showing ${filter === 'all' || near ? 'all kinds' : filter === 'setup' ? 'quiet (set-up) moves' : 'moves with an immediate effect'}, best ${pick.length} by the engine's one-move heuristic h (a rough guide that ignores your long-term plan):`];
  pick.forEach(f => L.push(factLine(f)));
  L.push('"result" is the exact outcome of this one placement under the real rules, achievements included (chain advances are answered by a simple rule here; in the game you choose them, and optional envoy/herald moves are skipped). "SCORES n" = cube steps on that colour.',
    'Other views: filter="setup" (quiet moves and what they prepare), filter="all", near="<col,row>" (everything within 2 cells of a town or field). engine_advice gives the built-in bot\'s opinion.');
  return L.join('\n');
}

/* ---------- inspect ---------- */
export function inspectText(g, key){
  const st = g.st; board(st);
  if (!E.nb()[key]) return `"${key}" is not a cell of this board. Coordinates are "col,row", e.g. "7,8".`;
  const who = (k) => { const e = st.board[k]; return e ? `seat ${e.p}${e.seal ? ' (sealed)' : ''}` : (E.farmer().has(k) ? `empty farmer slot [${TILE_TEXT[st.farmerTiles[k]]}]` : 'empty'); };
  const L = [];
  if (E.town()[key]){
    const t = E.town()[key]; L.push(`${key}: ${t.color} town${st.heralds.includes(key) ? ' WITH HERALD (+1 step)' : ''}. ${E.tf()[key].some(f => st.board[f]) ? 'Already visited: scoring it gives 2 steps' : 'Not visited yet: the first scoring gives 1 step'}${st.heralds.includes(key) ? ' (+1 for the herald)' : ''}.`);
    L.push('Adjacent fields:'); E.tf()[key].forEach(f => L.push(`  ${f}: ${who(f)}`));
    const adjTowns = E.nb()[key].filter(k => E.town()[k]); if (adjTowns.length) L.push('Adjacent towns: ' + adjTowns.map(k => `${k} ${E.town()[k].color}`).join(', '));
  } else {
    L.push(`${key}: field, ${who(key)}.`);
    const e = st.board[key];
    if (e){ const grp = E.groupOf(st, key); const towns = new Set(); grp.forEach(f => E.ft()[f].forEach(t => towns.add(t)));
      L.push(`Group of seat ${e.p}: ${grp.size} envoy(s): ${[...grp].join(' ')}`, `Towns this group touches now (a new envoy of this group cannot score them while another envoy of the group is next to them): ${[...towns].map(t => `${t} ${E.town()[t].color}`).join(', ') || 'none'}`); }
    L.push('Neighbours:'); E.nb()[key].forEach(k => L.push(`  ${k}: ${E.town()[k] ? `${E.town()[k].color} town${st.heralds.includes(k) ? ' +herald' : ''}` : who(k)}`));
  }
  return L.join('\n');
}

/* ---------- board reference ---------- */
export function boardText(id){
  E.setBoard(id); const L = [`Board "${id}": ${Object.keys(E.town()).length} towns, ${Object.keys(E.ff()).length} fields${E.farmer().size ? `, ${E.farmer().size} farmer slots (tiles are dealt at random each game)` : ''}.`, 'Towns by colour:'];
  for (const c of E.TRACK_COLORS) L.push(`  ${c}: ${Object.entries(E.town()).filter(([, t]) => t.color === c).map(([k, t]) => k + (t.icon ? `[${t.icon}]` : '')).join(' ')}`);
  L.push('Town icons [star]/[o]/[x] mark the possible herald start sets: one icon is drawn per game and its four towns start with a herald.');
  if (E.farmer().size) L.push('Farmer slots: ' + [...E.farmer()].join(' '));
  const blank = { boardId: id, heralds: [], board: {}, farmerTiles: {} };
  L.push('', mapText(blank).replace(/f\?/g, 'f '));
  return L.join('\n');
}
