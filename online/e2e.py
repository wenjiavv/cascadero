# 私人牌桌端到端回归（Playwright 双浏览器）：BASE=http://127.0.0.1:5321/ PIN=<房主口令> SITE=<站点配对码> [CHROME_ARGS="--host-resolver-rules=MAP your.host 10.0.0.2"] [SHOTS=../shots/] python3 e2e.py

import asyncio, time, json, os
from playwright.async_api import async_playwright
BASE=os.environ.get('BASE','http://127.0.0.1:5321/'); PIN=os.environ.get('PIN','testpin'); SITE=os.environ.get('SITE','abc123'); ARGS=[a for a in os.environ.get('CHROME_ARGS','').split('|') if a]
OUT=os.environ.get('SHOTS', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'shots')+'/'); os.makedirs(OUT, exist_ok=True)
async def main():
    async with async_playwright() as pw:
        b=await pw.chromium.launch(args=ARGS)
        errs=[]
        async def mk(name):
            ctx=await b.new_context(viewport={'width':1480,'height':1000}); pg=await ctx.new_page()
            pg.on('pageerror', lambda e,n=name: errs.append(n+' PAGEERROR '+str(e)))
            pg.on('console', lambda m,n=name: errs.append(n+' '+m.type+' '+m.text) if m.type=='error' else None)
            return ctx,pg
        c1,A=await mk('A'); c2,B=await mk('B')
        await A.goto(BASE); await A.wait_for_timeout(300)
        assert await A.query_selector('#pin'), 'gate page expected'
        await A.fill('#pin', SITE); await A.click('button[type=submit]'); await A.wait_for_function("document.getElementById('map')!==null", timeout=8000); await A.wait_for_timeout(300)
        print('gate passed')
        await A.evaluate("document.getElementById('modalBg').classList.remove('show')")
        await A.click('#btnOnline'); await A.fill('#onOwner',PIN); await A.click('#onCreate')
        await A.wait_for_function("NET.room && document.getElementById('modal').dataset.kind==='lobby'", timeout=8000)
        link=await A.evaluate("document.querySelector('#modal input[readonly]').value"); print('invite', link)
        await A.fill('#lbName','房主'); await A.click('.lb-sit[data-i="0"]'); await A.wait_for_timeout(300)
        await B.goto(link); await B.wait_for_function("document.getElementById('modal').dataset.kind==='lobby'", timeout=8000)
        await B.fill('#lbName','朋友'); await B.click('.lb-sit[data-i="1"]'); await B.wait_for_timeout(400)
        seats=await A.evaluate("NET.view.seats.slice(0,2).map(s=>[s.name,s.taken,s.online])"); print('seats', seats)
        await A.screenshot(path=OUT+'online-lobby.png')
        await A.click('#lbStart'); await A.wait_for_function("NET.view && NET.view.phase==='playing'", timeout=8000); await B.wait_for_function("NET.view && NET.view.phase==='playing'", timeout=8000)
        pages={0:A,1:B}
        async def play_one():
            v=await A.evaluate("({seat:NET.view.pending&&NET.view.pending.seat, kind:NET.view.pending&&NET.view.pending.kind, turn:S&&S.turn.num})")
            pg=pages[v['seat']]
            await pg.wait_for_function("UI.mode==='place'", timeout=8000)
            k=await pg.evaluate("""()=>{ const me=NET.me; const legal=legalFields(S,me); let best=null; for (const k of legal){ if (evalPlacement(S,k,me,false).scorings.length){ best=k; break; } }
                if (!best){ const near=legal.filter(k=>FIELD_TOWNS[k].length); best=near[Math.floor(Math.random()*near.length)]; }
                document.querySelector(`polygon[data-k="${best}"]`).dispatchEvent(new MouseEvent('click',{bubbles:true})); return best; }""")
            # 若弹出印章询问则不用印章
            await pg.wait_for_timeout(150)
            if await pg.evaluate("document.getElementById('modalBg').classList.contains('show') && document.getElementById('modal').innerText.includes('使用印章')"):
                await pg.click('#modal button[data-i="1"]')
            await A.wait_for_function(f"S && (S.turn.num>{v['turn']} || (NET.view.pending && NET.view.pending.kind!=='place'))", timeout=8000)
            # 处理可能的推进选择弹窗（chooseCube）
            for pg2 in (A,B):
                if await pg2.evaluate("document.getElementById('modal').dataset.kind==='ask' && document.getElementById('modalBg').classList.contains('show')"):
                    await pg2.click('#modal .opts button:not([disabled])')
                    await pg2.wait_for_timeout(300)
            return v, k
        log=[]
        for i in range(6):
            v,k=await play_one(); log.append((v['seat'],k))
            await A.wait_for_timeout(400)
        print('moves', log)
        stA=await A.evaluate("({turn:S.turn.num, n:Object.keys(S.board).length, vp:S.players.map(p=>p.vp)})"); stB=await B.evaluate("({turn:S.turn.num, n:Object.keys(S.board).length, vp:S.players.map(p=>p.vp)})")
        print('sync A', stA, 'B', stB)
        await A.screenshot(path=OUT+'online-play.png')
        # 撤销：上一手是谁就由谁请求，对方同意
        last=log[-1][0]; req=pages[last]; oth=pages[1-last]
        before=await A.evaluate("S.turn.num")
        await req.click('#btnUndo')
        await oth.wait_for_function("document.getElementById('modal').dataset.kind==='undo' && document.getElementById('modalBg').classList.contains('show')", timeout=8000)
        await oth.screenshot(path=OUT+'online-undo.png')
        await oth.click('#modal button[data-i="0"]')
        await A.wait_for_function(f"S && S.turn.num<{before}", timeout=8000)
        after=await A.evaluate("({turn:S.turn.num, n:Object.keys(S.board).length, pending:NET.view.pending&&NET.view.pending.seat})"); print('undo before turn', before, 'after', after, 'requester', last)
        # 重连：B 刷新
        await B.reload(); await B.wait_for_function("NET.view && NET.view.phase==='playing' && NET.me===1", timeout=8000)
        print('B reconnected, me=', await B.evaluate("NET.me"))
        # 再走一手确认继续可玩
        v,k=await play_one(); print('after undo move by seat', v['seat'], k)
        # 错误配对码
        c3,C=await mk('C'); await C.goto(BASE+'?room='+link.split('room=')[1].split('&')[0]+'&pin=000000'); await C.wait_for_timeout(800)
        print('bad invite ->', await C.evaluate("document.getElementById('msg')?document.getElementById('msg').textContent:'(no gate)'"))
        print('errors', errs[:6])
        await b.close()
asyncio.run(main())
