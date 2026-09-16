// 自对弈对照：node duel.js <局数> '<tuneA JSON>' '<tuneB JSON>' [level] [输出文件] [front|back|both]
// 环境变量 PAIRED=1：配对赛——每两局同一开局（同农夫板块布局/同起手座位/同版图与使者棋），A、B 互换座位；按分差与配对胜场判定
const E=require('./engine.js'); const fs=require('fs');
const n=+process.argv[2]||40, tA=JSON.parse(process.argv[3]||'{}'), tB=JSON.parse(process.argv[4]||'{}'), lvl=+(process.argv[5]||3), out=process.argv[6], onlyBoard=process.argv[7]||'both';
for (const t of [tA,tB]) if (typeof t.net==='string') t.net=require(require('path').resolve(t.net));   // tune.net=权重文件路径：该方单独用这个模型
const PAIRED=process.env.PAIRED==='1'; const NP=Math.max(2,Math.min(4,+(process.env.PLAYERS||2)));   // PLAYERS=3/4：A 坐一个座位，其余座位全是 B；配对=每 NP 局同开局轮换 A 的座位
if (process.env.NET){ E.setValueNet(require(require('path').resolve(process.env.NET))); console.log('value net loaded from', process.env.NET); }   // NET=权重文件：用指定模型替换引擎内嵌的 VALUE_NET
(async()=>{
  let winA=0, winB=0, margin=0, turns=0; const t0=Date.now(); const rows=[]; let saved=null; const pairs=[];
  for (let g=0; g<n; g++){
    const pairIdx=Math.floor(g/NP);
    const board=onlyBoard!=='both'?onlyBoard:((PAIRED?pairIdx:g)%4<2?'front':'back'); const herald=['star','o','x'][(PAIRED?Math.floor(pairIdx/6):g)%3];   // 与颜色组合解耦
    E.setBoard(board);
    const aSeat = PAIRED ? g%NP : 0;
    const ALLC=['blue','pink','yellow','orange']; const COLOR_PAIRS=[['blue','pink'],['blue','yellow'],['blue','orange'],['pink','yellow'],['pink','orange'],['yellow','orange']];
    const cols = NP>2 ? ALLC.slice(0,NP) : (PAIRED ? COLOR_PAIRS[pairIdx%6] : (g%2?['pink','blue']:['blue','pink']));   // 2 人配对赛轮换六种两色组合
    const players=[]; for (let i=0;i<NP;i++) players.push({name:i===aSeat?'A':'B', color:cols[i], level:lvl});
    const st=E.newState({players, herald, board});
    if (PAIRED){ if (g%NP===0){ saved={farmerTiles:JSON.parse(JSON.stringify(st.farmerTiles)), start:Math.floor(pairIdx/18)%NP}; } st.farmerTiles=JSON.parse(JSON.stringify(saved.farmerTiles)); st.turn.player=saved.start; st.start=saved.start; }
    else { st.turn.player=g%NP; st.start=g%NP; }
    for (let i=0;i<NP;i++) st.players[i].tune = i===aSeat ? tA : tB;
    let guard=0; while(!st.ended && guard++<600) await E.runTurn(st,E.botDecide);
    turns+=st.turn.num;
    const w=st.result?st.players[st.result.winner].name:'?'; if (w==='A') winA++; else if (w==='B') winB++;
    const m=st.players[aSeat].vp-Math.max(...st.players.filter((_,i)=>i!==aSeat).map(p=>p.vp)); margin+=m;
    rows.push({g,board,herald,aSeat,w,vp:st.players.map(p=>p.vp),own:st.players.map(p=>p.cubes[p.color]),m});
    if (PAIRED && g%NP===NP-1){ let sum=0; for (let i=g-NP+1;i<=g;i++) sum+=rows[i].m; pairs.push(sum); }
    if ((g+1)%10===0 || g===n-1){
      let line=`[${g+1}/${n}] A ${winA} : B ${winB}  avg margin ${(margin/(g+1)).toFixed(2)}  ${((Date.now()-t0)/turns).toFixed(0)}ms/turn`;
      if (PAIRED && pairs.length){ const mean=pairs.reduce((a,b)=>a+b,0)/pairs.length; const sd=Math.sqrt(pairs.reduce((a,b)=>a+(b-mean)*(b-mean),0)/Math.max(1,pairs.length-1)); const se=sd/Math.sqrt(pairs.length);
        line+=`  配对 ${pairs.length} 组: 分差和均值 ${mean.toFixed(2)} ±${se.toFixed(2)}  配对胜 ${pairs.filter(x=>x>0).length}/平 ${pairs.filter(x=>x===0).length}/负 ${pairs.filter(x=>x<0).length}`; }
      console.log(line); if (out) fs.writeFileSync(out, JSON.stringify({n:g+1,winA,winB,margin:margin/(g+1),tA,tB,lvl,paired:PAIRED,pairs,rows}));
    }
  }
  let tail='';
  if (PAIRED && pairs.length){ const mean=pairs.reduce((a,b)=>a+b,0)/pairs.length; const sd=Math.sqrt(pairs.reduce((a,b)=>a+(b-mean)*(b-mean),0)/Math.max(1,pairs.length-1)); tail=`  PAIRED mean ${mean.toFixed(2)} se ${(sd/Math.sqrt(pairs.length)).toFixed(2)} pairwins ${pairs.filter(x=>x>0).length}/${pairs.length}`; }
  console.log(`DONE A(${JSON.stringify(tA)}) vs B(${JSON.stringify(tB)}) level ${lvl}: A ${winA} / B ${winB} / ${n}  A 胜率 ${(100*winA/n).toFixed(1)}%  avg margin ${(margin/n).toFixed(2)}${tail}`);
})();
