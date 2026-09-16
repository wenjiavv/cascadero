#!/usr/bin/env python3
"""把 valuenet.json 嵌进 index.html 的 VALUE_NET 常量（VALUE_NET=null 或已有对象均可替换）。用法: python3 embed-net.py valuenet.json"""
import sys, json, re, pathlib
net=json.load(open(sys.argv[1])); p=pathlib.Path(__file__).resolve().parent.parent/'index.html'; s=p.read_text(encoding='utf-8')
new='let VALUE_NET='+json.dumps(net,separators=(',',':'))+';   // 学习式估值权重（online/train.py 生成；样本 %d，隐层 %d）'%(net['samples'],net['hidden'])
s2,n=re.subn(r'let VALUE_NET=.*?;   // 学习式估值权重[^\n]*|let VALUE_NET=null;[^\n]*', new, s, count=1, flags=re.S)
assert n==1, 'VALUE_NET 定义未找到'
p.write_text(s2,encoding='utf-8'); print('embedded, bytes', len(new))
