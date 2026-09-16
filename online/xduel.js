// 跨引擎对照：node xduel.js <局数> <engineA.js> <engineB.js> [board=back]   （PAIRED=1 配对赛）
// A/B 各用自己的引擎做决策，状态用同一份 JSON 推进（两边规则相同）；用于比较"修复前后的引擎"
const path=require('path'); const fs=require('fs');
const n=+process.argv[2]||40, EA=require(path.resolve(process.argv[3])), EB=require(path.resolve(process.argv[4])), board=process.argv[5]||'back';
const PAIRED=process.env.PAIRED==='1';
(async()=>{
  let winA=0, margin=0; const pairs=[]; let saved=null; const rows=[]; const t0=Date.now(); let turns=0;
  for (let g=0; g<n; g++){
    const pairIdx=Math.floor(g/2); const herald=['star','o','x'][pairIdx%3]; const aSeat=PAIRED?g%2:0;
    EA.setBoard(board); EB.setBoard(board);
    const names=aSeat===0?['A','B']:['B','A'];
    const st=EA.newState({players:[{name:names[0],color:'blue',level:3},{name:names[1],color:'pink',level:3}], herald, board});
    if (PAIRED){ if (g%2===0) saved={farmerTiles:JSON.parse(JSON.stringify(st.farmerTiles)), start:pairIdx%2}; st.farmerTiles=JSON.parse(JSON.stringify(saved.farmerTiles)); st.turn.player=saved.start; st.start=saved.start; }
    let guard=0;
    while(!st.ended && guard++<600){ const dec = st.turn.player===aSeat ? EA.botDecide : EB.botDecide; await EA.runTurn(st, dec); }   // 固定 A 引擎做规则裁判，只切换决策器
    turns+=st.turn.num;
    const w=st.result?st.players[st.result.winner].name:'?'; if (w==='A') winA++;
    const m=st.players[aSeat].vp-st.players[1-aSeat].vp; margin+=m; rows.push({g,aSeat,w,vp:st.players.map(p=>p.vp),own:st.players.map(p=>p.cubes[p.color]),m});
    if (PAIRED && g%2===1) pairs.push(rows[g-1].m+rows[g].m);
    if ((g+1)%10===0 || g===n-1){ let line=`[${g+1}/${n}] A 胜 ${winA}  avg margin ${(margin/(g+1)).toFixed(2)}  ${((Date.now()-t0)/turns).toFixed(0)}ms/turn`;
      if (pairs.length){ const mean=pairs.reduce((a,b)=>a+b,0)/pairs.length; const sd=Math.sqrt(pairs.reduce((a,b)=>a+(b-mean)*(b-mean),0)/Math.max(1,pairs.length-1)); line+=`  配对 ${pairs.length}: 均值 ${mean.toFixed(2)} ±${(sd/Math.sqrt(pairs.length)).toFixed(2)} 配对胜 ${pairs.filter(x=>x>0).length}`; }
      console.log(line); if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify({n:g+1,winA,margin:margin/(g+1),pairs,rows})); }
  }
  const mean=pairs.length?pairs.reduce((a,b)=>a+b,0)/pairs.length:0; const sd=pairs.length>1?Math.sqrt(pairs.reduce((a,b)=>a+(b-mean)*(b-mean),0)/(pairs.length-1)):0;
  console.log(`DONE A(${process.argv[3]}) vs B(${process.argv[4]}): A 胜 ${winA}/${n} (${(100*winA/n).toFixed(1)}%) avg margin ${(margin/n).toFixed(2)}${pairs.length?`  PAIRED mean ${mean.toFixed(2)} se ${(sd/Math.sqrt(pairs.length)).toFixed(2)} pairwins ${pairs.filter(x=>x>0).length}/${pairs.length}`:''}`);
})();
