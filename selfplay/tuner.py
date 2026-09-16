#!/usr/bin/env python3
# 自对弈爬山调参（在多核机器上跑，engine.js 由 online/build-engine.py 生成）:纳入人类策略先验(印章/传令官/联动/步数经济);nice 低优先级 + 限并行控温
import json, random, subprocess, time
import os
MATCH=os.path.join(os.path.dirname(os.path.abspath(__file__)),"match.js")   # 对局 CLI，见同目录 match.js
DEF={"ownBase":1.6,"ownProg":0,"qualBonus":2,"sealCost":0,"blockW":1.0,"rollMix":0.5,
     "stepW":1.0,"extraW":2.5,"sealGainW":2.0,"heraldW":0,"wasteP":0,"chainSealW":2.0,"chainExtraW":2.5,"firstGiftP":0,"farmerMoveW":1.0}
PARAMS={"ownBase":(0.8,3.0,0.3),"ownProg":(0,3,0.4),"qualBonus":(0,8,1.0),"sealCost":(0,2,0.4),
        "blockW":(0,2,0.4),"rollMix":(0,1.5,0.25),
        "stepW":(0.6,1.6,0.2),"extraW":(1.0,5.0,0.6),"sealGainW":(1.0,5.0,0.6),
        "heraldW":(0,2.5,0.5),"wasteP":(0,1.5,0.3),"chainSealW":(1.0,6.0,0.7),"chainExtraW":(1.0,6.0,0.7),"firstGiftP":(0,2.0,0.4),"farmerMoveW":(0.5,3.0,0.4)}
PRIOR=["sealGainW","extraW","chainSealW","chainExtraW","firstGiftP","farmerMoveW"]     # 用户指定的重点方向,加倍抽中概率
PAR=10                                               # 并行进程(控温:10/20 核)
def chunk(a,b,n):
    cfg=json.dumps({"n":n,"a":{"level":3,"tune":a},"b":{"level":3,"tune":b}})
    return subprocess.Popen(["nice","-n","10","node",MATCH,cfg],stdout=subprocess.PIPE)
def match(a,b,total=50,par=PAR):
    per=max(1,total//par); procs=[]
    for _ in range(par//2): procs.append(("F",chunk(a,b,per)))
    for _ in range(par//2): procs.append(("R",chunk(b,a,per)))
    wa=wb=0
    for side,p in procs:
        try: out=json.loads(p.communicate(timeout=1800)[0])
        except Exception as e: p.kill(); raise SystemExit(f"match.js 失败: {e}")
        if side=="F": wa+=out.get("A",0); wb+=out.get("B",0)
        else: wa+=out.get("B",0); wb+=out.get("A",0)
    return wa,wb
pool=list(PARAMS)+PRIOR                              # 先验方向权重翻倍
champion={"sealGainW": 2.78, "extraW": 3.13, "stepW": 0.74, "ownBase": 1.34, "chainSealW": 2.6, "chainExtraW": 2.8, "rollMix": 0.99, "farmerMoveW": 1.4, "firstGiftP": 0.4}  # 起点带上用户先验
log=open("tune_log.jsonl","a"); it=0
print("tuner v4 start, champion seed:", champion, flush=True)
while True:
    it+=1; cand=dict(champion)
    for k in random.sample(pool,random.choice([1,2])):
        lo,hi,sd=PARAMS[k]; cur=cand.get(k,DEF[k])
        cand[k]=round(min(hi,max(lo,cur+random.gauss(0,sd))),2)
    t0=time.time(); wa,wb=match(cand,champion); acc=wa>=29   # 29/50=58% 才接受
    rec={"it":it,"cand":cand,"w":[wa,wb],"acc":acc,"sec":int(time.time()-t0)}
    log.write(json.dumps(rec)+"\n"); log.flush(); print(rec, flush=True)
    if acc: champion=cand
    if it%10==0:
        va,vb=match(champion,{},total=50)
        rec={"anchor":True,"it":it,"champ":champion,"w":[va,vb]}
        log.write(json.dumps(rec)+"\n"); log.flush(); print(rec, flush=True)
    time.sleep(3)
