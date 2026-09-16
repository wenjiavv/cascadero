// 自动调参：[PAIRED=1] node tune.js <back|front> [并行数=3] [小时=8]   （PAIRED=配对赛，用分差均值/标准误判定）
// 锚点=当前默认（含版图覆盖）；每轮扰动 1~3 个权重 → 80 局筛选(≥46 胜) → 200 局终验(≥110 胜) → 接受为新锚点
// 输出 tune-<board>/log.jsonl（每次对照一行）与 state.json（当前锚点+接受历史）
const {spawn}=require('child_process'); const fs=require('fs'); const path=require('path');
const E=require('./engine.js');
const board=process.argv[2]||'back', workers=+(process.argv[3]||3), hours=+(process.argv[4]||8); const PAIRED=process.env.PAIRED==='1';
const OUT=path.join(__dirname,'tune-'+board); fs.mkdirSync(OUT,{recursive:true});
const LOG=path.join(OUT,'log.jsonl'), STATE=path.join(OUT,'state.json');
const SPACE={
  back:{padW:[0,0.4],burnP:[0.5,3],openP:[0,1.5],nearW:[0,0.6],farmerNearW:[0.2,1.4],firstGiftP:[0.2,1.3],sealGainW:[2.5,6.5],chainSealW:[3,8],stepW:[0.7,1.7],extraW:[1.2,3.2],ownBase:[1,2.6],ownProg:[0.2,1.6],qualBonus:[1,4],chainExtraW:[0.8,3],farmerMoveW:[0.5,3],sealCost:[0,1.2]},
  front:{padW:[0,0.6],firstGiftP:[0.2,1.3],sealGainW:[2.5,6.5],chainSealW:[3,8],stepW:[0.7,1.7],extraW:[1.2,3.2],ownBase:[1,2.6],ownProg:[0.2,1.6],qualBonus:[1,4],chainExtraW:[0.8,3],heraldW:[0,1.5],wasteP:[0,0.6],blockW:[0,1],sealCost:[0,1.2]},
}[board];
const BOARD_BASE={back:{padW:0,burnP:1.5,openP:0.75,nearW:0.25,farmerNearW:0.6}, front:{}}[board];
let state; try{ state=JSON.parse(fs.readFileSync(STATE,'utf8')); }catch(e){ state={anchor:Object.assign({}, E.BOT_TUNE, BOARD_BASE), accepted:[], screened:0, started:new Date().toISOString()}; }
const saveState=()=>fs.writeFileSync(STATE, JSON.stringify(state,null,1));
const log=o=>fs.appendFileSync(LOG, JSON.stringify(Object.assign({ts:new Date().toISOString()},o))+'\n');
const randn=()=>{ let u=0,v=0; while(!u) u=Math.random(); while(!v) v=Math.random(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); };
function perturb(anchor){
  const keys=Object.keys(SPACE); const n=1+Math.floor(Math.random()*3); const pick=new Set(); while(pick.size<n) pick.add(keys[Math.floor(Math.random()*keys.length)]);
  const c=Object.assign({}, anchor); const changed={};
  for (const k of pick){ const [lo,hi]=SPACE[k]; let v=anchor[k]||0;
    v = v===0 ? lo+Math.random()*(hi-lo)*0.5 : v*Math.exp(randn()*0.35);
    v=Math.max(lo,Math.min(hi,v)); v=+v.toFixed(3); c[k]=v; changed[k]=v; }
  return {tune:c, changed};
}
function duel(n, tA, tB, out){ return new Promise(res=>{
  const p=spawn('node',[path.join(__dirname,'duel.js'), String(n), JSON.stringify(tA), JSON.stringify(tB), '3', out, board]);
  let last=''; p.stdout.on('data',d=>{ last+=d.toString(); }); p.on('close',()=>{ const m=last.match(/A (\d+) \/ B (\d+) \/ (\d+)/); const pm=last.match(/PAIRED mean (-?[\d.]+) se ([\d.]+)/); res(m?{winA:+m[1],winB:+m[2],n:+m[3],mean:pm?+pm[1]:null,se:pm?+pm[2]:null}:null); }); }); }
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let running=0, id=0, confirming=false; const deadline=Date.now()+hours*3600e3;
async function worker(w){
  while (Date.now()<deadline){
    if (confirming){ await sleep(5000); continue; }          // 终验期间不再筛新候选，避免锚点漂移中途换
    const {tune,changed}=perturb(state.anchor); const cid=++id; const anchorSnap=JSON.stringify(state.anchor);
    const r=await duel(80, tune, state.anchor, path.join(OUT,`c${cid}.json`)); if (!r) continue;
    state.screened++; log({phase:'screen', id:cid, changed, winA:r.winA, n:r.n, mean:r.mean, se:r.se});
    const pass = PAIRED ? (r.mean!==null && r.mean>=4 && r.se>0 && r.mean/r.se>=1.8) : r.winA>=46;
    if (pass && JSON.stringify(state.anchor)===anchorSnap && !confirming){
      confirming=true; log({phase:'confirm-start', id:cid, changed});
      const r2=await duel(200, tune, state.anchor, path.join(OUT,`c${cid}-200.json`));
      const ok=r2 && (PAIRED ? (r2.mean!==null && r2.mean>=3 && r2.se>0 && r2.mean/r2.se>=3) : r2.winA>=110); log({phase:'confirm', id:cid, changed, winA:r2?r2.winA:null, mean:r2?r2.mean:null, se:r2?r2.se:null, n:200, accepted:ok});
      if (ok){ state.anchor=tune; state.accepted.push({id:cid, changed, screen:r.winA, confirm:r2.winA, ts:new Date().toISOString()}); }
      confirming=false; saveState();
    }
    saveState();
  }
}
console.log(`tune ${board}: workers ${workers}, ${hours}h, anchor`, JSON.stringify(state.anchor));
Promise.all(Array.from({length:workers},(_,i)=>worker(i))).then(()=>{ log({phase:'end', screened:state.screened, accepted:state.accepted.length}); console.log('tune end'); });
