import json, subprocess, time
import os
MATCH=os.path.join(os.path.dirname(os.path.abspath(__file__)),"match.js")   # 对局 CLI，见同目录 match.js
CANDS={
"A_it30":{"sealGainW":2.31,"extraW":3.13,"stepW":0.77,"ownBase":1.34,"chainSealW":2.76,"chainExtraW":2.1,"rollMix":0.99,"farmerMoveW":1.4,"firstGiftP":0.16,"heraldW":0},
"B_it413":{"sealGainW":4.28,"extraW":2.16,"stepW":1.19,"ownBase":1.78,"chainSealW":5.46,"chainExtraW":1.73,"rollMix":1.41,"farmerMoveW":1.65,"firstGiftP":0.73,"heraldW":0,"wasteP":0,"ownProg":0.8,"blockW":0,"sealCost":0.57,"qualBonus":2.47},
"C_it317":{"sealGainW":5.0,"extraW":2.42,"stepW":1.21,"ownBase":2.1,"chainSealW":3.86,"chainExtraW":1.0,"rollMix":1.39,"farmerMoveW":2.74,"firstGiftP":0.73,"heraldW":0,"wasteP":0,"ownProg":0.33,"blockW":0.88,"sealCost":0.57,"qualBonus":2.47},
}
def chunk(a,b,n):
    cfg=json.dumps({"n":n,"a":{"level":3,"tune":a},"b":{"level":3,"tune":b}})
    return subprocess.Popen(["nice","-n","10","node",MATCH,cfg],stdout=subprocess.PIPE)
def match(a,b,total=200,par=10):
    per=total//par; procs=[]
    for _ in range(par//2): procs.append(("F",chunk(a,b,per)))
    for _ in range(par//2): procs.append(("R",chunk(b,a,per)))
    wa=wb=0
    for side,p in procs:
        try: out=json.loads(p.communicate(timeout=3600)[0])
        except Exception as e: p.kill(); raise SystemExit(f"match.js 失败: {e}")
        if side=="F": wa+=out.get("A",0); wb+=out.get("B",0)
        else: wa+=out.get("B",0); wb+=out.get("A",0)
    return wa,wb
for name,t in CANDS.items():
    t0=time.time(); wa,wb=match(t,{})
    print(f"{name}: {wa} - {wb} 默认 ({wa*100//(wa+wb)}%)  [{int(time.time()-t0)}s]", flush=True)
print("VALIDATE-DONE")
