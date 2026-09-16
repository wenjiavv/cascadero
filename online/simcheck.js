// 差分测试：正式引擎 runTurn（用与 simEval 同样的同步次级决策）vs simEval 的一步模拟，比较落子后的状态
// 用法: node simcheck.js [局数=20] [board=back]
const E=require('./engine.js'); const n=+process.argv[2]||20, board=process.argv[3]||'back';
const fieldsOf=(st,pi)=>{ const pl=st.players[pi]; return {board:st.board, vp:st.players.map(p=>p.vp), cubes:st.players.map(p=>p.cubes), seals:st.players.map(p=>p.seals), unique:st.unique, teal:st.players.map(p=>p.teal), tealAll:st.players.map(p=>p.tealAll), heralds:st.heralds.slice().sort(), tracks:st.tracks, envoys:st.players.map(p=>p.envoys)}; };
(async()=>{
  let placements=0, mismatches=0; const kinds={};
  for (let g=0; g<n; g++){
    E.setBoard(board); const st=E.newState({players:[{name:'A',color:'blue',level:2},{name:'B',color:'pink',level:2}],herald:['star','o','x'][g%3],board}); st.players.forEach(p=>p.tune={detCube:1});
    // 同步决策：▲ 用 botPickCube，移使者用 botMoveEnvoy，使者棋不移（simEval 也不移）
    const dec={ choosePlacement:E.botDecide.choosePlacement, chooseCube:async(s,pi)=>E.botPickCube(s,pi,[]), chooseMove:async(s,pi)=>E.botMoveEnvoyExport?E.botMoveEnvoyExport(s,pi):null, chooseHerald:async()=>null };
    let guard=0;
    while(!st.ended && guard++<600){
      const pi=st.turn.player; if (st.players[pi].envoys<=0) break; const pick=await E.botDecide.choosePlacement(st,pi); if (!pick) break;
      const sim=E.simEval(st,pi,pick.key,pick.seal,1);
      // 正式引擎走同一步
      const real=JSON.parse(JSON.stringify(st)); E.setBoard(board);
      await E.runTurn(real, Object.assign({}, dec, {choosePlacement:async()=>pick}));
      placements++;
      const a=fieldsOf(sim.st,pi), b=fieldsOf(real,pi);
      for (const k of Object.keys(a)){ if (JSON.stringify(a[k])!==JSON.stringify(b[k])){ mismatches++; kinds[k]=(kinds[k]||0)+1; if (mismatches<=6) console.log(`局${g} 手${placements} 字段 ${k} 不一致\n  sim : ${JSON.stringify(a[k]).slice(0,160)}\n  real: ${JSON.stringify(b[k]).slice(0,160)}`); } }
      // 用正式引擎的状态继续
      Object.assign(st, real);
    }
  }
  console.log(`落子 ${placements} 次，字段不一致 ${mismatches} 次`, kinds);
})();
