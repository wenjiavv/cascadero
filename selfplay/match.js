// 多核机爬山调参用的对局 CLI：node match.js '<配置 JSON>'  → stdout 一行 JSON {"A":胜场,"B":胜场,"n":局数,"draws":平局}
// 配置：{"n":50,"a":{"level":3,"tune":{...}},"b":{"level":3,"tune":{...}},"board":"both|front|back"}
// A 固定坐 0 号位（tuner.py/validate.py 自己做 A/B 换边），颜色、使者棋、版图、先手按局号轮换；引擎取自 ../online/engine.js（先跑 online/build-engine.py）
const path=require('path');
const E=require(path.join(__dirname,'..','online','engine.js'));
const cfg=JSON.parse(process.argv[2]||'{}'); const n=+cfg.n||50, A=cfg.a||{}, B=cfg.b||{}, onlyBoard=cfg.board||'both';
(async()=>{
  let wa=0, wb=0, draws=0;
  for (let g=0; g<n; g++){
    const board=onlyBoard!=='both'?onlyBoard:(g%4<2?'front':'back'); E.setBoard(board);
    const cols=g%2?['pink','blue']:['blue','pink'];
    const st=E.newState({players:[{name:'A',color:cols[0],level:+A.level||3},{name:'B',color:cols[1],level:+B.level||3}], herald:['star','o','x'][g%3], board});
    st.turn.player=g%2; st.start=g%2;
    st.players[0].tune=A.tune||{}; st.players[1].tune=B.tune||{};
    let guard=0; while(!st.ended && guard++<600) await E.runTurn(st,E.botDecide);
    const w=st.result?st.players[st.result.winner].name:null; if (w==='A') wa++; else if (w==='B') wb++; else draws++;
  }
  process.stdout.write(JSON.stringify({A:wa,B:wb,n,draws})+'\n');
})().catch(e=>{ console.error(e); process.exit(1); });
