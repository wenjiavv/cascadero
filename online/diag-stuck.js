// 诊断“己色轨卡在禁行格下（10）”：node diag-stuck.js <局数> <输出.jsonl>
// 每局记录玩家0（现版 AI）在己色轨=10 期间的每一手：是否存在 ≥2 步己色计分机会（含印章）、AI 实际走法在己色轨上的步数、机会的来源
const E=require('./engine.js'); const fs=require('fs');
const n=+process.argv[2]||10, out=process.argv[3]||'diag-stuck.jsonl', tune=JSON.parse(process.argv[4]||'{}');
const ws=fs.createWriteStream(out,{flags:'a'});   // 第 4 参数为玩家 0 的 tune
(async()=>{
  for (let g=0; g<n; g++){
    E.setBoard('back'); const cols=g%2?['pink','blue']:['blue','pink'];
    const st=E.newState({players:[{name:'A',color:cols[0],level:3},{name:'B',color:cols[1],level:3}],herald:['star','o','x'][g%3],board:'back'});
    st.players[0].tune=tune; const me=0, myc=st.players[0].color; const events=[]; let guard=0;
    while(!st.ended && guard++<600){
      const pi=st.turn.player;
      if (pi===me && st.players[me].cubes[myc]===10){
        // 机会扫描：所有合法落点（含印章）里，己色计分 ≥2 步的
        const FT=E.ft(); let opp=[]; const pl=st.players[me];
        for (const k of E.legalFields(st,me)){
          for (const seal of [false,true]){ if (seal && !(pl.seals>0 && E.canUseSealHere(st,k,me))) continue;
            const ev=E.evalPlacement(st,k,me,seal); for (const s of ev.scorings) if (s.color===myc && s.steps>=2) opp.push({k,seal,steps:s.steps,herald:s.herald,anyBefore:s.anyBefore}); } }
        // 己色城镇状态：几座已被到访（可 +2）、几座有使者棋、几座尚无人到访
        const towns=Object.keys(E.town()).filter(t=>E.town()[t].color===myc); const TF=E.tf();
        const visited=towns.filter(t=>TF[t].some(f=>st.board[f])).length, heraldOn=towns.filter(t=>st.heralds.includes(t)).length;
        const before=JSON.parse(JSON.stringify(st)); const n0=st.fx.length;
        await E.runTurn(st,E.botDecide);
        const after=st.players[me].cubes[myc]; const placed=st.fx.slice(n0).find(e=>e.t==='place');
        events.push({turn:before.turn.num, opps:opp.length, oppSteps:opp.map(o=>o.steps+(o.seal?'s':'')).join(','), seals:pl.seals, visited, heraldOn, towns:towns.length, moved:after-10, placedAdjOwn:placed?(FT[placed.k]||[]).some(t=>E.town()[t].color===myc):false, envoys:pl.envoys});
      } else await E.runTurn(st,E.botDecide);
    }
    const finalOwn=st.players[me].cubes[myc];
    ws.write(JSON.stringify({g, color:myc, finalOwn, vp:st.players.map(p=>p.vp), winner:st.result?st.result.winner:null, stuckTurns:events.length, events})+'\n');
    console.log(`局${g} 己色=${myc} 终点 ${finalOwn} 卡在10的手数 ${events.length} 分数 ${st.players.map(p=>p.vp)}`);
  }
  ws.end();
})();
