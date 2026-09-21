// One game session: runs the engine's turn loop, parks on a "pending" decision whenever an agent seat has to
// answer, validates the answer, and resumes. Same shape as the private table server (online/server.js), minus the network.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { E } from './engine.mjs';

export const LEVELS = { easy: 1, normal: 2, hard: 3 };
const LEVEL_NAME = { 1: 'Easy', 2: 'Normal', 3: 'Hard' };
const HIST_MAX = 40;
const clone = (o) => JSON.parse(JSON.stringify(o));

export class GameError extends Error {}

export class Game {
  constructor(id, cfg, store){
    this.id = id; this.cfg = cfg; this.store = store;
    this.gen = 0; this.pending = null; this.hist = []; this.waiters = []; this.error = null;
    this.lastSeen = null;            // last log entry already reported to the agent
    this.created = new Date().toISOString();
  }

  static create(id, opts, store){
    const seats = opts.seats && opts.seats.length ? opts.seats : ['agent', 'normal'];
    if (seats.length < 2 || seats.length > 4) throw new GameError('seats must list 2 to 4 players');
    if (!seats.includes('agent')) throw new GameError('at least one seat must be "agent"');
    const board = opts.board === 'back' ? 'back' : 'front';
    const colors = pickColors(seats.length, opts.colors);
    const herald = ['star', 'o', 'x'].includes(opts.herald) ? opts.herald : ['star', 'o', 'x'][Math.floor(Math.random() * 3)];
    const names = seats.map((s, i) => s === 'agent' ? (opts.agent_name && seats.filter(x => x === 'agent').length === 1 ? String(opts.agent_name).slice(0, 24) : `Agent${seats.filter(x => x === 'agent').length > 1 ? '-' + (i + 1) : ''}`) : `Bot-${LEVEL_NAME[LEVELS[s]]}${seats.filter(x => x === s).length > 1 ? '-' + (i + 1) : ''}`);
    const g = new Game(id, { board, seats, colors, herald, lang: opts.lang === 'zh' ? 'zh' : 'en', allow_undo: opts.allow_undo !== false }, store);
    E.setBoard(board);
    g.st = E.newState({ players: seats.map((s, i) => ({ name: names[i], color: colors[i], level: s === 'agent' ? 0 : LEVELS[s] })), herald, board });
    g.st.fx = null;                  // animation events are for the browser UI only
    if (Number.isInteger(opts.first) && opts.first >= 0 && opts.first < seats.length){ g.st.turn.player = opts.first; g.st.start = opts.first; }
    g.rec = { v: 1, source: 'mcp', id, started: g.created, board, herald, start: g.st.start, farmerTiles: clone(g.st.farmerTiles), players: g.st.players.map(p => ({ name: p.name, color: p.color, level: p.level })), moves: [] };
    g.saved = clone(g.st);
    return g;
  }

  static restore(data, store){
    const g = new Game(data.id, data.cfg, store);
    g.created = data.created; g.rec = data.rec; g.st = data.saved; g.saved = clone(data.saved); g.st.fx = null;
    return g;
  }

  isAgent(pi){ return this.cfg.seats[pi] === 'agent'; }

  /* ---------- turn loop ---------- */
  start(){ this.error = null; this.runLoop().catch((e) => { this.error = e; this.wake(); }); }

  async runLoop(){
    const gen = ++this.gen;
    while (!this.st.ended && gen === this.gen){
      const st = this.st, pi = st.turn.player;
      E.setBoard(st.boardId || 'front');
      const dec = this.isAgent(pi) ? this.agentDecide(pi, gen) : E.botDecide;
      try { await E.runTurn(st, this.recWrap(dec)); }
      catch (e) { if (e && e.abort) return; throw e; }
      if (gen !== this.gen || st !== this.st) return;
      this.saved = clone(st);
      if (st.ended) this.finish();
      this.persist();
    }
    this.wake();
  }

  agentDecide(seat, gen){
    const ask = (kind, why, opts) => new Promise((resolve, reject) => {
      if (gen !== this.gen) return reject({ abort: true });
      if (kind === 'place'){ this.hist.push({ seat, turn: this.st.turn.num, moves: this.rec.moves.length, snap: clone(this.st) }); if (this.hist.length > HIST_MAX) this.hist.shift(); }
      this.pending = { id: crypto.randomBytes(4).toString('hex'), seat, kind, why, opts, resolve, reject, gen };
      this.wake();
    });
    return {
      choosePlacement: () => ask('place', null, null),
      chooseCube: (st, pi, why) => ask('cube', why, E.cubeOptions(st, pi)),
      chooseMove: (st, pi, why) => { const mine = Object.keys(st.board).filter(k => st.board[k].p === pi && E.ff()[k].some(n => !st.board[n])); return mine.length ? ask('move', why, null) : Promise.resolve(null); },
      chooseHerald: (st, pi, why) => ask('herald', why, { from: st.heralds.slice(), to: E.heraldTargets(st) }),
    };
  }

  recWrap(dec){
    const push = (m) => { m.n = this.rec.moves.length; this.rec.moves.push(m); };
    return {
      choosePlacement: async (st, pi) => { const r = await dec.choosePlacement(st, pi); if (r) push({ a: 'place', p: pi, k: r.key, s: r.seal ? 1 : 0 }); return r; },
      chooseCube: async (st, pi, why) => { const r = await dec.chooseCube(st, pi, why); push({ a: 'cube', p: pi, c: r || null }); return r; },
      chooseMove: async (st, pi, why) => { const r = await dec.chooseMove(st, pi, why); push({ a: 'move', p: pi, m: r || null }); return r; },
      chooseHerald: async (st, pi, why) => { const r = await dec.chooseHerald(st, pi, why); push({ a: 'herald', p: pi, h: r || null }); return r; },
    };
  }

  wake(){ const w = this.waiters; this.waiters = []; w.forEach((f) => f()); }

  // Resolves once the game needs an agent answer, has ended, or the loop died.
  async settle(){
    while (!this.pending && !this.st.ended && !this.error) await new Promise((r) => this.waiters.push(r));
    if (this.error){ const e = this.error; throw new GameError('engine error: ' + (e && e.message || e)); }
  }

  /* ---------- answers ---------- */
  validate(kind, v){
    const st = this.st, pi = this.pending.seat; E.setBoard(st.boardId || 'front');
    if (kind === 'place'){
      if (!v || typeof v.key !== 'string') return { err: 'field must be a "col,row" string' };
      if (!E.nb()[v.key]) return { err: `${v.key} is not a cell of this board` };
      if (E.town()[v.key]) return { err: `${v.key} is a town, envoys go on the fields next to towns` };
      if (st.board[v.key]) return { err: `${v.key} is already occupied` };
      if (!E.legalFields(st, pi).includes(v.key)) return { err: `${v.key} is a farmer slot that is still locked: you need one of your envoys on a neighbouring field first` };
      const seal = !!v.seal;
      if (seal && !E.canUseSealHere(st, v.key, pi)) return { err: st.players[pi].seals <= 0 ? 'you have no seal to spend' : `a seal has no effect at ${v.key}: it only helps a lone envoy (not joining your group) that is next to a town` };
      return { v: { key: v.key, seal } };
    }
    if (kind === 'cube'){
      if (v === null) return { v: null };
      if (!E.TRACK_COLORS.includes(v)) return { err: 'color must be one of ' + E.TRACK_COLORS.join(', ') };
      const o = E.cubeOptions(st, pi).find(x => x.value === v);
      if (o.blocked) return { err: o.top ? `your ${v} cube is already at the top` : `your ${v} cube sits right under a barrier, a 1-step advance cannot cross it` };
      return { v };
    }
    if (kind === 'move'){
      if (v === null) return { v: null };
      const e = st.board[v.from]; if (!e || e.p !== pi) return { err: `${v.from} does not hold one of your envoys` };
      if (!(E.ff()[v.from] || []).includes(v.to)) return { err: `${v.to} is not a field adjacent to ${v.from}` };
      if (st.board[v.to]) return { err: `${v.to} is occupied` };
      return { v: { from: v.from, to: v.to } };
    }
    if (kind === 'herald'){
      if (v === null) return { v: null };
      if (!st.heralds.includes(v.from)) return { err: `no herald stands on ${v.from}; heralds are at ${st.heralds.join(' / ')}` };
      if (!E.heraldTargets(st).includes(v.to)) return { err: `${v.to} is not a valid destination (needs a town without a herald and with at least one empty adjacent field)` };
      return { v: { from: v.from, to: v.to } };
    }
    return { err: 'unknown decision kind' };
  }

  async answer(kind, value){
    await this.settle();
    if (this.st.ended) throw new GameError('the game is over');
    const p = this.pending;
    if (p.kind !== kind) throw new GameError(`the game is waiting for a "${p.kind}" decision from seat ${p.seat}, not "${kind}". ${HINT[p.kind]}`);
    const r = this.validate(kind, value);
    if (r.err) throw new GameError(r.err);
    this.pending = null; p.resolve(r.v);
    await this.settle();
  }

  /* ---------- undo ---------- */
  async undo(){
    if (!this.cfg.allow_undo) throw new GameError('undo is disabled for this game');
    await this.settle();
    const p = this.pending; let target = null;
    const atTurnStart = !this.st.ended && p && p.kind === 'place';                                     // the snapshot on top is "now": go back to the placement before it
    target = this.hist[this.hist.length - (atTurnStart ? 2 : 1)];                                      // otherwise (mid-turn or game over): back to the start of the last placement
    if (!target) throw new GameError('nothing to undo: there is no earlier placement of yours in this game');
    this.hist.length -= atTurnStart ? 2 : 1;                                                           // the loop pushes the snapshot again when it re-asks
    this.gen++; if (p){ this.pending = null; try { p.reject({ abort: true }); } catch (e) {} }
    this.st = clone(target.snap); this.st.fx = null; this.rec.moves.length = target.moves; delete this.rec.result;
    E.log(this.st, 'log.undoDone', { nm: this.st.players[target.seat].name, turn: target.turn });
    this.lastSeen = this.st.log[this.st.log.length - 2] || null;
    this.start(); await this.settle();
  }

  /* ---------- log cursor ---------- */
  newEvents(){
    const log = this.st.log; let i = this.lastSeen ? log.lastIndexOf(this.lastSeen) : -1;
    const out = log.slice(i + 1); if (log.length) this.lastSeen = log[log.length - 1];
    return out;
  }

  /* ---------- persistence ---------- */
  finish(){
    const st = this.st; if (!st.result) return;
    this.rec.result = { reason: st.result.reason, winner: st.result.winner, minor: st.result.minor, vp: st.players.map(p => p.vp), own: st.players.map(p => p.cubes[p.color]), ended: new Date().toISOString() };
    this.store.appendLog(this.rec);
  }
  persist(){ this.store.save(this); }
  toJSON(){ return { id: this.id, cfg: this.cfg, created: this.created, updated: new Date().toISOString(), ended: !!this.st.ended, rec: this.rec, saved: this.saved }; }
}

export const HINT = {
  place: 'Call place_envoy (list_moves shows the options).',
  cube: 'Call choose_track with a track colour (or skip).',
  move: 'Call move_envoy with from/to (or skip).',
  herald: 'Call move_herald with from/to (or skip).',
};

function pickColors(n, wanted){
  const all = E.PLAYER_COLORS.slice();
  if (Array.isArray(wanted) && wanted.length === n && wanted.every(c => all.includes(c)) && new Set(wanted).size === n) return wanted;
  for (let i = all.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
  return all.slice(0, n);
}

/* ---------- on-disk store: unfinished games survive a restart of the MCP client ---------- */
export class Store {
  constructor(dir){
    this.dir = dir; this.games = new Map(); this.current = null;
    fs.mkdirSync(path.join(dir, 'games'), { recursive: true }); fs.mkdirSync(path.join(dir, 'postgame'), { recursive: true });
  }
  file(id){ return path.join(this.dir, 'games', id + '.json'); }
  newId(){ let id; do { id = 'g' + crypto.randomBytes(3).toString('hex'); } while (this.games.has(id) || fs.existsSync(this.file(id))); return id; }
  save(g){ try { fs.writeFileSync(this.file(g.id), JSON.stringify(g)); } catch (e) { console.error('save', e.message); } }
  appendLog(rec){ try { fs.appendFileSync(path.join(this.dir, 'gamelog.jsonl'), JSON.stringify(rec) + '\n'); } catch (e) { console.error('gamelog', e.message); } }
  create(opts){ const g = Game.create(this.newId(), opts, this); this.games.set(g.id, g); this.current = g.id; g.persist(); g.start(); return g; }
  listSaved(){
    const out = [];
    for (const f of fs.readdirSync(path.join(this.dir, 'games'))){ if (!f.endsWith('.json')) continue;
      try { const d = JSON.parse(fs.readFileSync(path.join(this.dir, 'games', f), 'utf8')); out.push({ id: d.id, board: d.cfg.board, seats: d.cfg.seats, ended: d.ended, turn: d.saved.turn.num, vp: d.saved.players.map(p => p.vp), updated: d.updated, loaded: this.games.has(d.id) }); } catch (e) {} }
    return out.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  }
  get(id){
    id = id || this.current;
    if (!id) throw new GameError('no game in progress: call new_game first (or list_games / pass game_id to resume a saved one)');
    let g = this.games.get(id);
    if (!g){
      if (!/^[\w-]+$/.test(id) || !fs.existsSync(this.file(id))) throw new GameError(`unknown game_id "${id}"; list_games shows the saved ones`);
      g = Game.restore(JSON.parse(fs.readFileSync(this.file(id), 'utf8')), this); this.games.set(id, g); if (!g.st.ended) g.start();
    }
    this.current = id; return g;
  }
}
