#!/usr/bin/env node
/* 卡斯卡德罗 私人牌桌服务器：静态页 + WebSocket 房间 + 权威规则引擎（engine.js 由 index.html 自动生成）
   - 只有持房主口令的人能开房；进房要「房间码 + 配对码」（邀请链接把两者都带上）
   - 服务器按引擎回合循环推进，轮到真人就下发 ask，收到合法答复才继续；电脑座位在服务器上跑 AI
   - 撤销 = 请求者回退到自己上一手之前，必须其他真人全部同意 */
'use strict';
const http=require('http'), fs=require('fs'), path=require('path'), crypto=require('crypto');
const WebSocket=require('ws');
const E=require('./engine.js');

const PORT=+(process.env.PORT||5235);
const ROOT=process.env.CASC_ROOT||__dirname;
const DATA=process.env.CASC_DATA||path.join(__dirname,'data');
const OWNER_PIN=(process.env.CASC_OWNER_PIN||'').trim();
const SITE_PIN=(process.env.CASC_SITE_PIN||'').trim();
if (!OWNER_PIN){ console.error('缺少环境变量 CASC_OWNER_PIN（房主口令）'); process.exit(1); }
if (!SITE_PIN){ console.error('缺少环境变量 CASC_SITE_PIN（站点配对码）'); process.exit(1); }
fs.mkdirSync(DATA,{recursive:true});
/* ---------- 站点门禁：没有授权 cookie 只能看到配对码页；配对码正确或邀请链接有效才发 30 天授权；改配对码=旧授权全部失效 ---------- */
let SECRET=''; try{ SECRET=fs.readFileSync(path.join(DATA,'secret.key'),'utf8').trim(); }catch(e){}
if (SECRET.length<32){ SECRET=crypto.randomBytes(32).toString('hex'); fs.writeFileSync(path.join(DATA,'secret.key'),SECRET,{mode:0o600}); }
const AUTH_DAYS=30;
const pinHash=()=>crypto.createHash('sha256').update(SITE_PIN).digest('hex').slice(0,8);
function makeToken(){ const body=(Math.floor(Date.now()/1000)+AUTH_DAYS*86400)+'.'+pinHash(); return body+'.'+crypto.createHmac('sha256',SECRET).update(body).digest('hex').slice(0,40); }
function checkToken(t){ if (!t||typeof t!=='string') return false; const q=t.split('.'); if (q.length!==3) return false; const [exp,ph,sig]=q;
  if (!(+exp>Date.now()/1000) || ph!==pinHash()) return false; const want=crypto.createHmac('sha256',SECRET).update(exp+'.'+ph).digest('hex').slice(0,40);
  return sig.length===want.length && crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(want)); }
function cookies(req){ const o={}; (req.headers.cookie||'').split(';').forEach(c=>{ const i=c.indexOf('='); if (i>0) o[c.slice(0,i).trim()]=decodeURIComponent(c.slice(i+1).trim()); }); return o; }
const authed=req=>checkToken(cookies(req).casc_auth);
function setAuthCookie(req,res){ const secure=String(req.headers['x-forwarded-proto']||'').includes('https'); res.setHeader('Set-Cookie', `casc_auth=${makeToken()}; Path=/; Max-Age=${AUTH_DAYS*86400}; HttpOnly; SameSite=Lax${secure?'; Secure':''}`); }
const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function gatePage(msg){ return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>卡斯卡德罗 · Cascadero</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#1b4d4a;color:#2f2113;font:15px/1.6 -apple-system,"PingFang SC","Noto Sans SC",sans-serif}
.card{background:#f7eed9;border:3px solid #4a3120;border-radius:12px;padding:26px 30px;width:min(92vw,380px);box-shadow:inset 0 0 0 3px #f7eed9,inset 0 0 0 4px #b48f5a,0 12px 30px rgba(0,0,0,.35)}
h1{margin:0 0 4px;font:700 26px/1.2 "Songti SC","STSong","Noto Serif CJK SC",Georgia,serif;letter-spacing:3px;color:#4a3120}p{margin:6px 0 14px;font-size:13px;color:#5a4634}
input{font:inherit;font-size:20px;letter-spacing:4px;text-align:center;width:100%;box-sizing:border-box;padding:8px;border:1px solid #b48f5a;border-radius:6px;background:#fff;text-transform:uppercase}
button{font:inherit;width:100%;margin-top:10px;padding:9px;border:1px solid #a67a1f;border-radius:6px;background:#d9a83a;color:#2f2113;font-weight:600;cursor:pointer}button:hover{background:#f5d36a}
.msg{color:#a5501a;font-size:13px;min-height:18px;margin-top:8px}.hint{font-size:12px;color:#7a5a3a;margin-top:12px}</style></head><body><div class="card">
<h1>卡斯卡德罗</h1><p>私人对局站点。请输入朋友告诉你的配对码。</p>
<form id="f"><input id="pin" name="pin" autocomplete="one-time-code" placeholder="配对码" maxlength="12" autofocus><button type="submit">进入</button></form>
<div class="msg" id="msg">${esc(msg||'')}</div><div class="hint">如果收到的是邀请链接，直接打开链接即可，不需要配对码。</div></div>
<script>document.getElementById('f').onsubmit=async e=>{e.preventDefault();const m=document.getElementById('msg');m.textContent='验证中…';
try{const r=await fetch('auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:document.getElementById('pin').value.trim()})});const j=await r.json();
if(j.ok){location.reload();}else m.textContent=j.msg||'配对码不对';}catch(err){m.textContent='网络出错，请重试';}};</script></body></html>`; }
function sendGate(res,msg,code){ res.writeHead(code||200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}); res.end(gatePage(msg)); }
function readBody(req,limit){ return new Promise((resolve,reject)=>{ let b=''; req.on('data',d=>{ b+=d; if (b.length>limit){ req.destroy(); reject(new Error('too large')); } }); req.on('end',()=>resolve(b)); req.on('error',reject); }); }
const ROOMS_FILE=path.join(DATA,'rooms.json'), GAMELOG=path.join(DATA,'gamelog.jsonl');
const clone=o=>JSON.parse(JSON.stringify(o));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const BOT_PAUSE=1400, UNDO_TIMEOUT=120000, ROOM_TTL=7*864e5, HIST_MAX=24;
const CODE_ALPHA='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const genCode=n=>{ const b=crypto.randomBytes(n); let s=''; for(let i=0;i<n;i++) s+=CODE_ALPHA[b[i]%CODE_ALPHA.length]; return s; };
const genPin=()=>String(crypto.randomInt(0,1000000)).padStart(6,'0');
const cleanName=(s,d)=>{ s=String(s||'').replace(/[<>&"']/g,'').trim().slice(0,12); return s||d; };
const DEFAULT_SEATS=()=>[{name:'',color:'blue',level:0},{name:'',color:'pink',level:0},{name:'',color:'yellow',level:2},{name:'',color:'orange',level:2}].map(s=>Object.assign({token:null},s));
const LEVEL_NAME={1:'电脑·简单',2:'电脑·普通',3:'电脑·困难'};

const rooms={};
const MAX_ROOMS=+(process.env.CASC_MAX_ROOMS||8);   // 私人牌桌：同时存在的房间上限（本项目只面向自托管小圈子，不作公开服务运营）
const sockets=new Set();
const failLog={};   // ip → {n, until}

/* ---------- 房间 ---------- */
function newRoom(ownerId){
  let code; do code=genCode(6); while(rooms[code]);
  const room={code, pin:genPin(), owner:ownerId, created:Date.now(), updated:Date.now(), cfg:{n:2,board:'front',herald:'star'},
    seats:DEFAULT_SEATS(), phase:'lobby', st:null, saved:null, hist:[], rec:null, pending:null, undo:null, gen:0, spect:0};
  rooms[code]=room; return room;
}
function seatOf(room,id){ return room.seats.findIndex(s=>s.token===id); }
function seatName(room,i){ const s=room.seats[i]; return s.level>0 ? (s.name||LEVEL_NAME[s.level]) : (s.name||('玩家'+(i+1))); }
function isOnline(room,token){ for (const ws of sockets) if (ws.room===room.code && ws.id===token) return true; return false; }
function touch(room){ room.updated=Date.now(); }
function persist(){
  const out={};
  for (const c in rooms){ const r=rooms[c]; out[c]={code:r.code,pin:r.pin,owner:r.owner,created:r.created,updated:r.updated,cfg:r.cfg,seats:r.seats,phase:r.phase,st:r.saved,hist:r.hist,rec:r.rec}; }
  try{ fs.writeFileSync(ROOMS_FILE+'.tmp', JSON.stringify(out)); fs.renameSync(ROOMS_FILE+'.tmp', ROOMS_FILE); }catch(e){ console.error('persist', e.message); }
}
function load(){
  let d; try{ d=JSON.parse(fs.readFileSync(ROOMS_FILE,'utf8')); }catch(e){ return; }
  for (const c in d){ const r=d[c]; if (Date.now()-(r.updated||0)>ROOM_TTL) continue;
    rooms[c]=Object.assign({pending:null,undo:null,gen:0,spect:0}, r, {st:r.st?clone(r.st):null, saved:r.st||null, hist:r.hist||[]});
    if (rooms[c].phase==='playing' && rooms[c].st) runLoop(rooms[c]); }
  console.log('载入房间', Object.keys(rooms).length);
}
function sweep(){ const now=Date.now(); for (const c in rooms){ const r=rooms[c]; if (now-r.updated>ROOM_TTL){ if (r.rec && !r.rec.result) recFlush(r, 'expired'); abortLoop(r); delete rooms[c]; } } persist(); }
function shutdown(sig){ console.log('收到', sig, '，落盘后退出'); for (const c in rooms){ const r=rooms[c]; if (r.phase==='playing' && r.rec && !r.rec.result) recFlush(r, 'shutdown'); } persist(); process.exit(0); }
process.on('SIGTERM', ()=>shutdown('SIGTERM')); process.on('SIGINT', ()=>shutdown('SIGINT'));

/* ---------- 视图 & 广播 ---------- */
function view(room, ws){
  const me=seatOf(room, ws.id); const p=room.pending;
  return {t:'state', code:room.code, pin:room.pin, phase:room.phase, cfg:room.cfg, isOwner:ws.id===room.owner, me, sitePin: ws.id===room.owner?SITE_PIN:undefined,
    seats:room.seats.map((s,i)=>({name:seatName(room,i), color:s.color, level:s.level, taken:!!s.token, online:!!s.token&&isOnline(room,s.token), mine:s.token===ws.id})),
    st:room.st,
    pending:p?{id:p.id, seat:p.seat, kind:p.kind, why:p.why, opts:p.seat===me?p.opts:null}:null,
    undo:room.undo?{by:room.undo.by, needed:room.undo.needed, votes:room.undo.votes, t:room.undo.t}:null,
    watchers:[...sockets].filter(w=>w.room===room.code).length};
}
function send(ws,obj){ if (ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify(obj)); }
function broadcast(room){ for (const ws of sockets) if (ws.room===room.code) send(ws, view(room, ws)); }
function fail(ws,msg,fatal){ send(ws,{t:'error',msg,fatal:!!fatal}); }

/* ---------- 对局循环 ---------- */
function netDecide(room, pi, gen){
  const ask=(kind,why,opts)=>new Promise((resolve,reject)=>{
    if (gen!==room.gen) return reject({abort:true});
    room.pending={id:genCode(8), seat:pi, kind, why, opts, resolve, reject, gen}; broadcast(room); });
  return {
    choosePlacement:(st,pi)=>ask('place', '', null),
    chooseCube:(st,pi,why)=>ask('cube', why, cubeOpts(st,pi)),
    chooseMove:(st,pi,why)=>{ const mine=Object.keys(st.board).filter(k=>st.board[k].p===pi && E.ff()[k].some(n=>!st.board[n])); return mine.length? ask('move', why, null) : Promise.resolve(null); },
    chooseHerald:(st,pi,why)=>ask('herald', why, {targets:E.heraldTargets(st)}),
  };
}
function cubeOpts(st,pi){ const pl=st.players[pi]; return E.TRACK_COLORS.map(c=>{ const pos=pl.cubes[c]; const def=E.trackDef(c); const blocked=pos>=E.TOP||(def[pos+1]&&def[pos+1].x);
  return {label:`${E.CNAME[c]}：${pos} → ${blocked?(pos>=E.TOP?'已到顶':'被禁行格挡住'):pos+1}`, value:c, disabled:!!blocked}; }); }
function recFlush(room, tag){
  const r=room.rec; if (!r) return;
  const out=Object.assign({}, r, {updated:new Date().toISOString(), turn:room.st?room.st.turn.num:null, finished:!!r.result}); if (tag) out.tag=tag;
  try{ fs.appendFileSync(GAMELOG, JSON.stringify(out)+'\n'); }catch(e){ console.error('gamelog', e.message); }
}
function recWrap(room, dec){
  const push=m=>{ if (!room.rec) return; m.n=room.rec.moves.length; m.ts=Date.now(); room.rec.moves.push(m); if (room.rec.moves.length%6===0) recFlush(room); };
  return {
    choosePlacement: async (st,pi)=>{ const r=await dec.choosePlacement(st,pi); if(r) push({a:'place',p:pi,k:r.key,s:r.seal?1:0}); return r; },
    chooseCube: async (st,pi,why,pending)=>{ const r=await dec.chooseCube(st,pi,why,pending); push({a:'cube',p:pi,c:r||null}); return r; },
    chooseMove: async (st,pi,why)=>{ const r=await dec.chooseMove(st,pi,why); push({a:'move',p:pi,m:r||null}); return r; },
    chooseHerald: async (st,pi,why)=>{ const r=await dec.chooseHerald(st,pi,why); push({a:'herald',p:pi,h:r||null}); return r; },
  };
}
function abortLoop(room){ room.gen++; if (room.pending){ const p=room.pending; room.pending=null; try{ p.reject({abort:true}); }catch(e){} } }
async function runLoop(room){
  const gen=++room.gen;
  while (room.st && !room.st.ended && gen===room.gen){
    const st=room.st, pi=st.turn.player, pl=st.players[pi];
    E.setBoard(st.boardId||'front');
    if (!pl.bot){
      const last=room.hist[room.hist.length-1];
      if (last && last.turn===st.turn.num && last.seat===pi) last.snap=clone(st); else room.hist.push({seat:pi, turn:st.turn.num, snap:clone(st)});
      if (room.hist.length>HIST_MAX) room.hist.shift();
    } else { broadcast(room); await sleep(BOT_PAUSE); if (gen!==room.gen) return; E.setBoard(st.boardId||'front'); }
    const dec = pl.bot ? E.botDecide : netDecide(room, pi, gen);
    try { await E.runTurn(st, recWrap(room, dec)); }
    catch(e){ if (e && e.abort) return; console.error('runTurn', e); return; }
    if (gen!==room.gen || st!==room.st) return;
    room.saved=clone(st); touch(room);
    if (st.ended){ room.phase='ended'; recFinish(room); }
    persist(); broadcast(room);
  }
}
function recFinish(room){
  const st=room.st; if (!room.rec || !st || !st.result) return;
  room.rec.result={reason:st.result.reason, winner:st.result.winner, minor:st.result.minor, vp:st.players.map(p=>p.vp), own:st.players.map(p=>p.cubes[p.color]), ended:new Date().toISOString()};
  recFlush(room, 'end');
}

/* ---------- 答复校验 ---------- */
function validAnswer(room, kind, v){
  const st=room.st, pi=room.pending.seat; E.setBoard(st.boardId||'front');
  if (kind==='place'){
    if (!v || typeof v.key!=='string') return null;
    if (!E.legalFields(st,pi).includes(v.key)) return null;
    const seal=!!v.seal; if (seal && !E.canUseSealHere(st,v.key,pi)) return null;
    return {key:v.key, seal};
  }
  if (kind==='cube'){ if (v===null||v===undefined) return {v:null}; if (!E.TRACK_COLORS.includes(v)) return null;
    const pl=st.players[pi]; const pos=pl.cubes[v]; const def=E.trackDef(v); if (pos>=E.TOP||(def[pos+1]&&def[pos+1].x)) return null; return {v}; }
  if (kind==='move'){ if (v===null||v===undefined) return {v:null}; if (!v||typeof v.from!=='string'||typeof v.to!=='string') return null;
    const e=st.board[v.from]; if (!e||e.p!==pi) return null; if (!E.ff()[v.from]||!E.ff()[v.from].includes(v.to)||st.board[v.to]) return null; return {v:{from:v.from,to:v.to}}; }
  if (kind==='herald'){ if (v===null||v===undefined) return {v:null}; if (!v||typeof v.from!=='string'||typeof v.to!=='string') return null;
    if (!st.heralds.includes(v.from)||!E.heraldTargets(st).includes(v.to)) return null; return {v:{from:v.from,to:v.to}}; }
  return null;
}

/* ---------- 撤销（需其他真人同意） ---------- */
function requestUndo(room, seat, ws){
  if (room.phase!=='playing') return fail(ws,'现在不能撤销');
  if (room.undo) return fail(ws,'已有撤销请求在等待表决');
  let cands=room.hist.filter(h=>h.seat===seat);
  if (room.pending && room.pending.seat===seat && cands.length && cands[cands.length-1].turn===room.st.turn.num) cands.pop();
  if (!cands.length) return fail(ws,'你还没有可撤销的回合');
  const target=cands[cands.length-1];
  const needed=room.seats.map((s,i)=>i).filter(i=>i<room.cfg.n && i!==seat && room.seats[i].level===0 && room.seats[i].token);
  room.undo={by:seat, turn:target.turn, votes:{}, needed, t:Date.now()};
  room.st.log.push({m:`↩ ${seatName(room,seat)} 请求撤销到自己上一手之前${needed.length?'，等待其他玩家同意':''}`, c:''});
  if (!needed.length) return applyUndo(room);
  broadcast(room);
  setTimeout(()=>{ if (room.undo && room.undo.t<=Date.now()-UNDO_TIMEOUT+50){ room.undo=null; if (room.st) room.st.log.push({m:'↩ 撤销请求超时未获同意，已取消',c:''}); broadcast(room); } }, UNDO_TIMEOUT);
}
function voteUndo(room, seat, ok){
  const u=room.undo; if (!u || !u.needed.includes(seat) || u.votes[seat]!==undefined) return;
  u.votes[seat]=!!ok;
  if (!ok){ room.undo=null; room.st.log.push({m:`↩ ${seatName(room,seat)} 拒绝了撤销请求`,c:''}); return broadcast(room); }
  if (u.needed.every(i=>u.votes[i])) applyUndo(room); else broadcast(room);
}
function applyUndo(room){
  const u=room.undo; const idx=room.hist.findIndex(h=>h.turn===u.turn && h.seat===u.by); if (idx<0){ room.undo=null; return broadcast(room); }
  abortLoop(room);
  room.st=clone(room.hist[idx].snap); room.hist=room.hist.slice(0,idx); room.undo=null;
  room.st.log.push({m:`↩ 已撤销到 ${seatName(room,u.by)} 的上一手之前`, c:'t0'});
  if (room.rec){ room.rec.moves.push({a:'undo',turn:u.turn,n:room.rec.moves.length,ts:Date.now()}); recFlush(room, 'undo'); }
  room.saved=clone(room.st); touch(room); persist(); broadcast(room); runLoop(room);
}

/* ---------- 消息 ---------- */
function ipOf(req){ return (req.headers['x-forwarded-for']||'').split(',')[0].trim() || req.socket.remoteAddress || '?'; }
function locked(ip){ const f=failLog[ip]; return f && f.until>Date.now(); }
function noteFail(ip){ const f=failLog[ip]||(failLog[ip]={n:0,until:0}); f.n++; if (f.n>=5){ f.until=Date.now()+60000; f.n=0; } }
function join(ws, room){ ws.room=room.code; touch(room); send(ws,{t:'welcome',code:room.code,pin:room.pin,isOwner:ws.id===room.owner}); broadcast(room); }
function onMessage(ws, m){
  const room=ws.room?rooms[ws.room]:null; const seat=room?seatOf(room,ws.id):-1;
  switch(m.t){
    case 'create': {
      if (locked(ws.ip)) return fail(ws,'尝试太多次，请 1 分钟后再试',true);
      if (String(m.ownerPin||'')!==OWNER_PIN){ noteFail(ws.ip); return fail(ws,'房主口令不对',true); }
      if (Object.keys(rooms).length>=MAX_ROOMS) return fail(ws,'房间数已达上限（CASC_MAX_ROOMS），请稍后再试',true);
      const r=newRoom(ws.id); persist(); return join(ws, r); }
    case 'hello': {
      if (locked(ws.ip)) return fail(ws,'尝试太多次，请 1 分钟后再试',true);
      const r=rooms[String(m.room||'').toUpperCase().trim()];
      if (!r || r.pin!==String(m.pin||'').trim()){ noteFail(ws.ip); return fail(ws,'房间不存在或配对码不对',true); }
      return join(ws, r); }
    case 'leave': { if (room){ ws.room=null; broadcast(room); } return; }
    case 'ping': return send(ws,{t:'pong'});
  }
  if (!room) return fail(ws,'还没进入房间');
  switch(m.t){
    case 'sit': {
      if (room.phase!=='lobby') return fail(ws,'对局已开始，不能换座');
      const i=+m.seat; const s=room.seats[i]; if (!s||i>=room.cfg.n||s.level!==0) return fail(ws,'这个座位不能坐');
      if (s.token && s.token!==ws.id) return fail(ws,'座位已有人');
      room.seats.forEach(x=>{ if (x.token===ws.id) x.token=null; });
      s.token=ws.id; s.name=cleanName(m.name, '玩家'+(i+1)); touch(room); persist(); return broadcast(room); }
    case 'stand': { if (room.phase!=='lobby') return fail(ws,'对局已开始'); room.seats.forEach(x=>{ if (x.token===ws.id) x.token=null; }); persist(); return broadcast(room); }
    case 'config': {
      if (ws.id!==room.owner) return fail(ws,'只有房主能改设置'); if (room.phase!=='lobby') return fail(ws,'对局已开始');
      const c=m.cfg||{}; if ([2,3,4].includes(+c.n)) room.cfg.n=+c.n; if (['front','back'].includes(c.board)) room.cfg.board=c.board; if (['star','o','x'].includes(c.herald)) room.cfg.herald=c.herald;
      if (Array.isArray(c.seats)) c.seats.slice(0,4).forEach((cs,i)=>{ const s=room.seats[i]; if (!s||!cs) return;
        if (E.PLAYER_COLORS.includes(cs.color)) s.color=cs.color;
        if ([0,1,2,3].includes(+cs.level)){ const lv=+cs.level; if (lv!==s.level){ s.level=lv; s.token=null; s.name=''; } } });
      touch(room); persist(); return broadcast(room); }
    case 'start': {
      if (ws.id!==room.owner) return fail(ws,'只有房主能开始'); if (room.phase!=='lobby') return fail(ws,'对局已开始');
      const use=room.seats.slice(0,room.cfg.n);
      if (new Set(use.map(s=>s.color)).size!==use.length) return fail(ws,'玩家颜色不能重复');
      const empty=use.findIndex(s=>s.level===0 && !s.token); if (empty>=0) return fail(ws,`第 ${empty+1} 个座位还没人坐（或改成电脑）`);
      E.setBoard(room.cfg.board);
      const players=use.map((s,i)=>({name:seatName(room,i), color:s.color, level:s.level, bot:s.level>0}));
      const st=E.newState({players, herald:room.cfg.herald, board:room.cfg.board});
      st.log.push({m:`联机对局开始：${players.map(p=>p.name).join('、')}；房间 ${room.code}`, c:'t0'});
      room.st=st; room.saved=clone(st); room.hist=[]; room.undo=null; room.pending=null; room.phase='playing';
      room.rec=!players.some(p=>!p.bot)?null:{v:2, online:true, id:'g'+Date.now().toString(36)+Math.random().toString(36).slice(2,6), started:new Date().toISOString(), boardId:st.boardId, herald:st.heraldIcon, farmerTiles:st.farmerTiles, start:st.start, players:players.map(p=>({name:p.name,color:p.color,level:p.level})), resumed:null, moves:[], result:null};
      touch(room); persist(); broadcast(room); runLoop(room); return; }
    case 'answer': {
      const p=room.pending; if (!p || p.id!==m.id) return; if (p.seat!==seat) return fail(ws,'还没轮到你');
      const ok=validAnswer(room, p.kind, m.value);
      if (!ok){ fail(ws,'这一步不合法，请重新选择'); return send(ws, view(room, ws)); }
      room.pending=null; p.resolve(p.kind==='place'?ok:ok.v); return; }
    case 'undo': { if (seat<0) return fail(ws,'旁观者不能撤销'); return requestUndo(room, seat, ws); }
    case 'undoVote': { if (seat<0) return; return voteUndo(room, seat, !!m.ok); }
    case 'restart': {
      if (ws.id!==room.owner) return fail(ws,'只有房主能重开');
      if (room.phase==='playing' && room.rec && !room.rec.result) recFlush(room, 'abandoned');
      abortLoop(room); room.phase='lobby'; room.st=null; room.saved=null; room.hist=[]; room.undo=null; room.rec=null; touch(room); persist(); return broadcast(room); }
    default: return fail(ws,'未知消息');
  }
}

/* ---------- HTTP + WS ---------- */
const INDEX=path.join(ROOT,'index.html');
function serveIndex(res){ fs.readFile(INDEX,(err,data)=>{ if (err){ res.writeHead(500); return res.end('index.html 缺失'); }
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'}); res.end(data.toString('utf8').replace('<head>','<head><script>window.CASC_ONLINE=true</script>')); }); }
const server=http.createServer(async (req,res)=>{
  const u=new URL(req.url,'http://x'); const ip=ipOf(req);
  if (u.pathname==='/healthz'){ res.writeHead(200); return res.end('ok'); }
  if (u.pathname==='/auth' && req.method==='POST'){
    let pin=''; try{ pin=String(JSON.parse(await readBody(req,4096)).pin||'').trim(); }catch(e){}
    res.setHeader('Content-Type','application/json');
    if (locked(ip)){ res.writeHead(429); return res.end(JSON.stringify({ok:false,msg:'尝试太多次，请 1 分钟后再试'})); }
    if (pin && pin.toUpperCase()===SITE_PIN.toUpperCase()){ setAuthCookie(req,res); res.writeHead(200); return res.end('{"ok":true}'); }
    noteFail(ip); res.writeHead(401); return res.end(JSON.stringify({ok:false,msg:'配对码不对'}));
  }
  if (u.pathname==='/'||u.pathname==='/index.html'){
    if (authed(req)) return serveIndex(res);
    const room=u.searchParams.get('room'), pin=u.searchParams.get('pin');
    if (room && pin){
      if (locked(ip)) return sendGate(res,'尝试太多次，请 1 分钟后再试',429);
      const r=rooms[room.toUpperCase().trim()];
      if (r && r.pin===pin.trim()){ setAuthCookie(req,res); return serveIndex(res); }
      noteFail(ip); return sendGate(res,'邀请链接无效或已过期，可改用配对码进入');
    }
    return sendGate(res);
  }
  if (!authed(req)){ res.writeHead(401,{'Content-Type':'application/json'}); return res.end('{"error":"unauthorized"}'); }
  if (u.pathname==='/api/version'){ let v='0'; try{ v=String(Math.floor(fs.statSync(INDEX).mtimeMs/1000)); }catch(e){}
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}); return res.end(JSON.stringify({v})); }
  if (u.pathname==='/api/gamelog' && req.method==='POST'){
    let body=''; req.on('data',d=>{ body+=d; if (body.length>2e6) req.destroy(); });
    req.on('end',()=>{ try{ const rec=JSON.parse(body); if (!rec||typeof rec!=='object'||!rec.id||!rec.moves) throw 0; fs.appendFileSync(GAMELOG, JSON.stringify(rec)+'\n'); res.writeHead(200,{'Content-Type':'application/json'}); res.end('{"ok":true}'); }catch(e){ res.writeHead(400); res.end(); } });
    return; }
  res.writeHead(404); res.end('not found');
});
const wss=new WebSocket.Server({server, path:'/ws', maxPayload:64*1024});
wss.on('connection',(ws,req)=>{
  if (!authed(req)){ try{ ws.send(JSON.stringify({t:'error',fatal:true,msg:'授权已过期，请刷新页面重新输入配对码'})); }catch(e){} return ws.close(); }
  ws.id=null; ws.room=null; ws.ip=ipOf(req); ws.alive=true; sockets.add(ws);
  ws.on('pong',()=>{ ws.alive=true; });
  ws.on('message',data=>{ let m; try{ m=JSON.parse(data); }catch(e){ return; } if (!m||typeof m!=='object') return;
    if (!ws.id){ ws.id=String(m.id||'').replace(/[^\w-]/g,'').slice(0,40); if (!ws.id) return fail(ws,'缺少身份',true); }
    try{ onMessage(ws,m); }catch(e){ console.error('msg', e); fail(ws,'服务器处理出错'); } });
  ws.on('close',()=>{ sockets.delete(ws); if (ws.room && rooms[ws.room]) broadcast(rooms[ws.room]); });
});
setInterval(()=>{ for (const ws of sockets){ if (!ws.alive){ ws.terminate(); continue; } ws.alive=false; try{ ws.ping(); }catch(e){} } }, 30000);
setInterval(sweep, 3600e3);
load();
server.listen(PORT,'0.0.0.0',()=>console.log(`cascadero online :${PORT}  房间数 ${Object.keys(rooms).length}`));
