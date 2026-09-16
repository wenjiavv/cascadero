#!/usr/bin/env python3
"""从 index.html 抽出规则引擎（<script> 起到「人类决策（UI）」标记）生成 engine.js（CommonJS）。"""
import pathlib, re
root = pathlib.Path(__file__).resolve().parent.parent
src = root.joinpath('index.html').read_text(encoding='utf-8')
a = src.index('<script>') + len('<script>')
b = src.index('/* =====================  人类决策（UI）')
code = src[a:b]
out = "/* 自动生成：python3 online/build-engine.py —— 请勿手改，改 index.html 后重新生成 */\nconst window=globalThis; const sleep=ms=>new Promise(r=>setTimeout(r,ms));\n" + code + """
module.exports={newState,runTurn,botDecide,legalFields,canUseSealHere,heraldTargets,setBoard,trackDef,evalPlacement,farmerUnlocked,
  TOP,TRACK_COLORS,PLAYER_COLORS,CNAME,CSHORT,COL,BOARDS,BOT_TUNE,
  ff:()=>FIELD_FIELDS, ft:()=>FIELD_TOWNS, tf:()=>TOWN_FIELDS, nb:()=>NB, town:()=>TOWN, farmer:()=>FARMER, groupOf, botPickCube, botPickCubeSim, stateFeatures, phi, setValueNet:(n)=>{ VALUE_NET=n; }, simEval, botMoveEnvoyExport:botMoveEnvoy, decideWinner};
"""
pathlib.Path(__file__).resolve().parent.joinpath('engine.js').write_text(out, encoding='utf-8')
print('engine.js', len(out), 'bytes')
