// Random-play fuzz of the session layer (no protocol): random legal answers, random skips, random undos, 2-4 seats, both boards.
// Usage: node test/fuzz.mjs [games]
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { Store } from '../src/game.mjs'; import { E } from '../src/engine.mjs'; import * as V from '../src/view.mjs';
const N = +process.argv[2] || 40; const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cascadero-fuzz-')); const store = new Store(dir);
const pick = (a) => a[Math.floor(Math.random() * a.length)]; const kinds = {}; let undos = 0, refused = 0;
for (let n = 0; n < N; n++){
  const seats = pick([['agent', 'easy'], ['agent', 'agent'], ['easy', 'agent', 'normal'], ['agent', 'easy', 'agent', 'easy']]);
  const g = store.create({ seats, board: n % 2 ? 'back' : 'front', lang: n % 3 ? 'en' : 'zh' }); let steps = 0;
  while (true){
    await g.settle(); if (g.st.ended) break; if (++steps > 800) throw new Error('game does not end');
    const p = g.pending, st = g.st; E.setBoard(st.boardId); kinds[p.kind] = (kinds[p.kind] || 0) + 1;
    if (steps % 7 === 0){ V.stateText(g, { map: true }); await V.movesText(g, { filter: pick(['scoring', 'setup', 'all']), limit: 5 }); V.inspectText(g, pick(Object.keys(E.nb()))); }
    if (Math.random() < 0.03){ try { await g.undo(); undos++; } catch (e) { if (!/nothing to undo/.test(e.message)) throw e; } continue; }
    if (Math.random() < 0.05){ try { await g.answer(pick(['place', 'cube', 'move', 'herald']), pick([null, { key: '0,0' }, { from: '1,1', to: '9,9' }, 'white', { key: pick(Object.keys(E.town())) }])); } catch (e) { refused++; } continue; }
    if (p.kind === 'place'){ const legal = E.legalFields(st, p.seat); const sealable = st.players[p.seat].seals > 0 ? legal.filter(k => E.canUseSealHere(st, k, p.seat)) : [];
      if (sealable.length && Math.random() < 0.5) await g.answer('place', { key: pick(sealable), seal: true }); else await g.answer('place', { key: pick(legal), seal: false }); }
    else if (p.kind === 'cube'){ const o = p.opts.filter(x => !x.blocked); await g.answer('cube', Math.random() < 0.15 ? null : pick(o).value); }
    else if (p.kind === 'move'){ const mine = Object.keys(st.board).filter(k => st.board[k].p === p.seat && E.ff()[k].some(x => !st.board[x])); const from = pick(mine);
      await g.answer('move', Math.random() < 0.2 ? null : { from, to: pick(E.ff()[from].filter(x => !st.board[x])) }); }
    else await g.answer('herald', Math.random() < 0.2 ? null : { from: pick(p.opts.from), to: pick(p.opts.to) });
  }
  const tot = g.st.players.reduce((a, pl) => a + (30 - pl.envoys), 0); if (Object.keys(g.st.board).length !== tot) throw new Error('envoy count mismatch');
}
console.log(`${N} random games finished | decisions ${JSON.stringify(kinds)} | undos ${undos} | junk answers refused ${refused}`);
fs.rmSync(dir, { recursive: true, force: true }); process.exit(0);
