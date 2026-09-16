#!/usr/bin/env python3
"""学习式估值训练：读取 selfplay.js 产出的 JSONL（f=76 维特征, y=终局分差, w=胜负），训练 76→H→1 的 ReLU MLP，导出 valuenet.json。
用法: python3 train.py <samples.jsonl ...> [--hidden 32] [--epochs 30] [--out valuenet.json]
"""
import sys, json, glob, argparse, time, warnings
import numpy as np
warnings.filterwarnings('ignore')
ap=argparse.ArgumentParser(); ap.add_argument('files', nargs='+'); ap.add_argument('--hidden', type=int, default=32); ap.add_argument('--epochs', type=int, default=30)
ap.add_argument('--out', default='valuenet.json'); ap.add_argument('--ncols', type=int, default=0, help='只用前 N 维特征（对比用）'); ap.add_argument('--winK', type=float, default=0, help='目标改为 分差 + winK*(胜=+1/负=-1)，把获胜资格规则学进去'); ap.add_argument('--clip', type=float, default=40); ap.add_argument('--lr', type=float, default=2e-3); ap.add_argument('--l2', type=float, default=1e-5)
a=ap.parse_args()
X=[]; Y=[]; W=[]; G=[]; gid=-1; prev=None
for pat in a.files:
    for fn in glob.glob(pat):
        for line in open(fn):
            if not line.strip(): continue
            try: r=json.loads(line)
            except Exception: continue
            key=(fn, r['g'])
            if key!=prev: gid+=1; prev=key
            X.append(r['f']); Y.append(r['y']); W.append(r['w']); G.append(gid)
X=np.array(X,dtype=np.float32)
if a.ncols>0: X=X[:,:a.ncols]
Y=np.array(Y,dtype=np.float32); W=np.array(W,dtype=np.float32)
if a.winK>0: Y=Y+a.winK*(2*W-1)
Y=np.clip(Y,-a.clip,a.clip); G=np.array(G)
print('samples', X.shape, 'games', len(set(G.tolist())), 'y mean %.2f std %.2f'%(Y.mean(),Y.std()))
# 按局划分训练/验证，避免同局样本泄漏
rng=np.random.default_rng(0); games=np.array(sorted(set(G.tolist()))); rng.shuffle(games); val_games=set(games[:max(1,len(games)//10)].tolist())
vmask=np.array([g in val_games for g in G]); Xtr,Ytr,Xva,Yva=X[~vmask],Y[~vmask],X[vmask],Y[vmask]
mean=Xtr.mean(0); std=np.maximum(Xtr.std(0), 1e-3)   # 常量特征 std 置底，避免导出后除零
def z(x): return (x-mean)/std
Ztr,Zva=z(Xtr),z(Xva)
# 基线：手工估值特征（最后一维）线性拟合
PHI=75 if X.shape[1]>76 else X.shape[1]-1   # phi 差值特征所在维
phi=Xva[:,PHI]; A=np.vstack([phi,np.ones_like(phi)]).T; coef=np.linalg.lstsq(np.vstack([Xtr[:,PHI],np.ones(len(Xtr))]).T,Ytr,rcond=None)[0]
pred=A@coef; r2b=1-((Yva-pred)**2).mean()/Yva.var(); print('基线(手工估值线性) 验证 R2 %.3f MAE %.2f'%(r2b, np.abs(Yva-pred).mean()))
# 线性全特征基线
Alin=np.hstack([Ztr,np.ones((len(Ztr),1))]); cl=np.linalg.lstsq(Alin,Ytr,rcond=None)[0]; pl=np.hstack([Zva,np.ones((len(Zva),1))])@cl
print('线性(全特征) 验证 R2 %.3f MAE %.2f'%(1-((Yva-pl)**2).mean()/Yva.var(), np.abs(Yva-pl).mean()))
# MLP（numpy + Adam）
H=a.hidden; d=X.shape[1]; rng=np.random.default_rng(1)
W1=rng.normal(0,np.sqrt(2/d),(H,d)).astype(np.float32); b1=np.zeros(H,np.float32); W2=rng.normal(0,np.sqrt(1/H),H).astype(np.float32); b2=np.float32(Ytr.mean())
params=[W1,b1,W2,b2]; m=[np.zeros_like(p) for p in params]; v=[np.zeros_like(p) for p in params]; beta1,beta2,eps=0.9,0.999,1e-8; step=0
def forward(Z): h=np.maximum(0, Z@W1.T+b1); return h, h@W2+b2
best=(1e9,None); bs=512; t0=time.time()
for ep in range(a.epochs):
    idx=rng.permutation(len(Ztr)); lr=a.lr*(0.5**(ep//10))
    for i in range(0,len(idx),bs):
        j=idx[i:i+bs]; Z=Ztr[j]; y=Ytr[j]; h,out=forward(Z); err=out-y
        gW2=(err@h)/len(j)+a.l2*W2; gb2=err.mean(); gh=np.outer(err,W2)*(h>0); gW1=(gh.T@Z)/len(j)+a.l2*W1; gb1=gh.mean(0)
        step+=1
        for k,(p,g) in enumerate(zip(params,[gW1,gb1,gW2,gb2])):
            m[k]=beta1*m[k]+(1-beta1)*g; v[k]=beta2*v[k]+(1-beta2)*(g*g); mh=m[k]/(1-beta1**step); vh=v[k]/(1-beta2**step); p-=lr*mh/(np.sqrt(vh)+eps)
        W1,b1,W2,b2=params
    _,pv=forward(Zva); mse=((pv-Yva)**2).mean(); r2=1-mse/Yva.var()
    if mse<best[0]: best=(mse,[p.copy() for p in params])
    print('epoch %d 验证 R2 %.3f MAE %.2f (%.0fs)'%(ep+1, r2, np.abs(pv-Yva).mean(), time.time()-t0))
W1,b1,W2,b2=best[1]
_,pv=forward(Zva); Wva=W[vmask]; print('最佳 验证 R2 %.3f MAE %.2f；对真实胜负的方向准确率 %.3f'%(1-((pv-Yva)**2).mean()/Yva.var(), np.abs(pv-Yva).mean(), ((pv>0)==(Wva>0.5)).mean()))
json.dump({'mean':mean.round(5).tolist(),'std':std.round(5).tolist(),'W1':W1.round(5).tolist(),'b1':b1.round(5).tolist(),'W2':W2.round(5).tolist(),'b2':float(b2),'hidden':H,'features':d,'samples':int(len(X))}, open(a.out,'w'))
print('已导出', a.out)
