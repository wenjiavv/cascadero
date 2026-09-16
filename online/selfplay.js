// 训练数据生成：node selfplay.js <局数> <输出.jsonl> [level=3] [board=back] [explore=0.1] [useNet=0] [rich=0] [netRank=0]（useNet/netRank>0 时 AI 用引擎内嵌的 VALUE_NET；rich=1 记录富特征）
// 每回合开始时，从行动方与最高分对手两个视角各记一条样本：{f:特征, y:终局分差(视角方-对手最高分), w:是否胜, t:回合, g:局号}
const E=require('./engine.js'); const fs=require('fs');
const n=+process.argv[2]||100, out=process.argv[3]||'samples.jsonl', lvl=+(process.argv[4]||3), board=process.argv[5]||'back', explore=+(process.argv[6]||0.1), useNet=+(process.argv[7]||0), rich=+(process.argv[8]||0), netRank=+(process.argv[9]||0);
const ws=fs.createWriteStream(out,{flags:'a'});
(async()=>{
  const t0=Date.now(); let samples=0;
  for (let g=0; g<n; g++){
    E.setBoard(board);
    const cols=g%2?['pink','blue']:['blue','pink']; const herald=['star','o','x'][g%3];
    const st=E.newState({players:[{name:'A',color:cols[0],level:lvl},{name:'B',color:cols[1],level:lvl}], herald, board});
    st.players.forEach(p=>p.tune={explore, useNet, netRankW:netRank});
    const rows=[]; let guard=0;
    while (!st.ended && guard++<600){
      const pi=st.turn.player; const np=st.players.length;
      for (let who=0; who<np; who++){ rows.push({who, t:st.turn.num, f:E.stateFeatures(st,who,rich>0).map(v=>+v.toFixed(4))}); }
      await E.runTurn(st,E.botDecide);
    }
    if (!st.result) continue;
    const vps=st.players.map(p=>p.vp);
    for (const r of rows){ const opp=Math.max(...vps.filter((_,i)=>i!==r.who)); const y=vps[r.who]-opp; const w=st.result.winner===r.who?1:0; const q=st.players[r.who].cubes[st.players[r.who].color]>=15?1:0; const qo=st.players.some((p,i)=>i!==r.who&&p.cubes[p.color]>=15)?1:0;
      ws.write(JSON.stringify({f:r.f, y, w, q, qo, t:r.t, g, tot:st.turn.num})+'\n'); samples++; }
    if ((g+1)%20===0) console.log(`[${g+1}/${n}] samples ${samples} ${((Date.now()-t0)/(g+1)/1000).toFixed(1)}s/game`);
  }
  ws.end(); console.log('DONE games', n, 'samples', samples, 'features', rows0len());
  function rows0len(){ E.setBoard(board); const s=E.newState({players:[{name:'A',color:'blue',level:3},{name:'B',color:'pink',level:3}],herald:'star',board}); return E.stateFeatures(s,0,rich>0).length; }
})();
