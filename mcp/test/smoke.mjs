// End-to-end check over the real MCP protocol (stdio): a scripted client plays whole games and pokes at the edges.
// Usage: node test/smoke.mjs            (uses a throw-away data directory)
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.mjs');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cascadero-mcp-test-'));
let failed = 0; const ok = (c, m) => { if (c) console.log('  ok  ', m); else { failed++; console.log('  FAIL', m); } };

async function connect(){
  const client = new Client({ name: 'smoke', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath], env: { ...process.env, CASC_MCP_DATA: dataDir }, stderr: 'ignore' }));
  const call = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }); return { err: !!r.isError, text: r.content.map(c => c.text).join('\n') }; };
  return { client, call };
}
const pendingKind = (t) => { const m = t.match(/DECISION NEEDED from seat (\d+) \([^)]*\): (place an envoy|.*)/); if (!m) return null;
  const kind = /place an envoy/.test(m[2]) ? 'place' : /choose_track/.test(t) ? 'cube' : /move_envoy/.test(t) ? 'move' : /move_herald/.test(t) ? 'herald' : '?'; return { seat: +m[1], kind }; };

// one decision, answered the way a simple agent would: top of list_moves for placements, the bot's advice for sub-decisions
async function step(call, stats){
  const s = await call('get_state'); if (/GAME OVER/.test(s.text)) return s.text;
  const p = pendingKind(s.text); if (!p) throw new Error('no pending decision in:\n' + s.text);
  stats[p.kind] = (stats[p.kind] || 0) + 1; let r;
  if (p.kind === 'place'){
    const lm = await call('list_moves', { limit: 3 }); const m = lm.text.match(/^  (\d+,\d+)( \+SEAL)? \|/m); if (!m) throw new Error('cannot parse list_moves:\n' + lm.text);
    r = await call('place_envoy', { field: m[1], use_seal: !!m[2] });
  } else {
    const adv = (await call('engine_advice', { level: 'normal' })).text; let m;
    if (p.kind === 'cube') r = (m = adv.match(/advance the (\w+) cube/)) ? await call('choose_track', { color: m[1] }) : await call('choose_track', { skip: true });
    else if (p.kind === 'move') r = (m = adv.match(/envoy (\d+,\d+) -> (\d+,\d+)/)) ? await call('move_envoy', { from: m[1], to: m[2] }) : await call('move_envoy', { skip: true });
    else r = (m = adv.match(/herald (\d+,\d+) -> (\d+,\d+)/)) ? await call('move_herald', { from: m[1], to: m[2] }) : await call('move_herald', { skip: true });
  }
  if (r.err){ stats.errors = (stats.errors || 0) + 1; throw new Error(`legal-looking ${p.kind} answer was rejected: ${r.text}`); }
  return /GAME OVER/.test(r.text) ? r.text : null;
}
async function playOut(call, stats, maxSteps = 400){ for (let i = 0; i < maxSteps; i++){ const end = await step(call, stats); if (end) return end; } throw new Error('game did not end'); }

const { client, call } = await connect();

console.log('1. protocol surface');
const tools = (await client.listTools()).tools.map(t => t.name);
ok(tools.length === 13 && ['new_game', 'place_envoy', 'choose_track', 'move_envoy', 'move_herald', 'undo', 'engine_advice'].every(t => tools.includes(t)), `13 tools: ${tools.join(' ')}`);
const res = (await client.listResources()).resources.map(r => r.uri); ok(res.includes('cascadero://handbook') && res.includes('cascadero://board/back'), `resources: ${res.join(' ')}`);
const hb = await client.readResource({ uri: 'cascadero://handbook/zh' }); ok(/规则摘要/.test(hb.contents[0].text), 'handbook (zh) readable');
const pr = await client.getPrompt({ name: 'cascadero_play', arguments: { opponent: 'hard' } }); ok(/"agent","hard"/.test(pr.messages[0].content.text), 'prompt renders');
ok(/BARRIER/.test((await call('get_rules', { topic: 'tracks' })).text) && /Towns by colour/.test((await call('get_rules', { topic: 'board_back' })).text), 'get_rules topics');
ok((await call('get_state')).err, 'get_state before any game is a clean error');

console.log('2. illegal answers are refused and change nothing');
let r = await call('new_game', { seats: ['agent', 'easy'], board: 'front', first: 0, herald: 'star', colors: ['blue', 'pink'] }); ok(!r.err && /DECISION NEEDED from seat 0/.test(r.text) && /Map \(/.test(r.text), 'new_game returns state, map and first decision');
const gid1 = r.text.match(/New game (\w+)/)[1];
const before = (await call('get_state')).text;
for (const [name, args, why] of [
  ['place_envoy', { field: '4,4' }, 'town cell'], ['place_envoy', { field: '99,99' }, 'off the board'], ['place_envoy', { field: '7,8', use_seal: true }, 'seal without having one'],
  ['choose_track', { color: 'blue' }, 'wrong decision kind'], ['move_envoy', { from: '1,1', to: '1,2' }, 'wrong decision kind'], ['move_herald', { skip: true }, 'wrong decision kind'],
  ['place_envoy', { field: 'abc' }, 'malformed coordinate'], ['undo', {}, 'nothing to undo yet'], ['get_state', { game_id: 'nope' }, 'unknown game id']]){
  let e; try { e = await call(name, args); } catch (x) { e = { err: true, text: String(x.message) }; } ok(e.err, `refused (${why}): ${e.text.split('\n')[0].slice(0, 90)}`); }
await call('place_envoy', { field: '7,8' }); r = await call('place_envoy', { field: '7,8' }); ok(r.err && /occupied/.test(r.text), 'occupied field refused');
ok(before.split('\n')[0] !== '' && /turn/.test((await call('get_state')).text), 'game still alive after the refusals');

console.log('3. undo');
const t0 = +(await call('get_state')).text.match(/turn (\d+)/)[1];
await step(call, {}); await step(call, {}); const t1 = +(await call('get_state')).text.match(/turn (\d+)/)[1];
r = await call('undo'); const t2 = +r.text.match(/turn (\d+)/)[1]; ok(!r.err && t2 < t1 && t2 >= t0 - 2, `undo rewinds (turn ${t1} -> ${t2})`);

console.log('4. full game vs easy bot, front board');
let stats = {}; let end = await playOut(call, stats); ok(/GAME OVER/.test(end) && !stats.errors, `finished: ${end.split('\n')[0]} | decisions ${JSON.stringify(stats)}`);
ok((await call('place_envoy', { field: '1,1' })).err, 'no moves accepted after the end');
r = await call('save_postgame_notes', { notes: '- smoke test note: greedy top-of-list play, nothing learned.' }); ok(!r.err && /cascadero:\/\/postgame\//.test(r.text), r.text);
ok(/smoke test note/.test((await call('get_rules')).text), 'handbook now carries the saved lesson');

console.log('5. full game on the back board, 3 seats, two of them agents, vs hard bot');
r = await call('new_game', { seats: ['agent', 'hard', 'agent'], board: 'back', lang: 'zh' }); ok(!r.err, 'new_game back/3p'); const gid2 = r.text.match(/New game (\w+)/)[1];
stats = {}; end = await playOut(call, stats); ok(/GAME OVER/.test(end) && !stats.errors, `finished: ${end.split('\n')[0]} | decisions ${JSON.stringify(stats)}`);

console.log('6. an unfinished game survives a server restart');
r = await call('new_game', { seats: ['agent', 'normal'], board: 'back' }); const gid3 = r.text.match(/New game (\w+)/)[1];
for (let i = 0; i < 6; i++) await step(call, {}); const vpBefore = (await call('get_state')).text.match(/turn (\d+)/)[1];
await client.close();
const second = await connect();
const list = await second.call('list_games'); ok(list.text.includes(gid3) && list.text.includes(gid1) && /finished/.test(list.text), 'list_games shows finished and unfinished games');
r = await second.call('get_state', { game_id: gid3 }); ok(!r.err && /DECISION NEEDED/.test(r.text), `resumed ${gid3} at turn ${r.text.match(/turn (\d+)/)[1]} (was ${vpBefore})`);
stats = {}; end = await playOut(second.call, stats); ok(/GAME OVER/.test(end), `resumed game played to the end: ${end.split('\n')[0]}`);
const log = fs.readFileSync(path.join(dataDir, 'gamelog.jsonl'), 'utf8').trim().split('\n').map(JSON.parse); ok(log.length === 3 && log.every(g => g.result && g.moves.length > 20), `gamelog.jsonl has ${log.length} finished games with full move lists`);
await second.client.close();

fs.rmSync(dataDir, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed'); process.exit(failed ? 1 : 0);
