const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

exports.run = async ({pw, root, browserPath = pw.chromium.executablePath(), log = ()=>{}}) => {
  const lines = [];
  async function step(value) { lines.push(value); log(value); await fs.writeFile(path.join(root,'work/browser-test.log'),lines.join('\n')); }
  const extension = path.resolve(__dirname,'..');
  const profile = path.join(root,'work/profile-' + Date.now());
  const ctx = await pw.chromium.launchPersistentContext(profile,{
    executablePath:browserPath,
    headless:true,ignoreDefaultArgs:['--disable-extensions'],
    args:['--enable-unsafe-extension-debugging'],
    viewport:{width:380,height:860},acceptDownloads:true,downloadsPath:path.join(root,'work/downloads')
  });
  ctx.setDefaultTimeout(7000);
  const errors=[];
  ctx.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  try {
    const cdp=await ctx.browser().newBrowserCDPSession();
    const loaded=await cdp.send('Extensions.loadUnpacked',{path:extension});
    await step('Loaded extension '+loaded.id);
    const panel=await ctx.newPage();
    await panel.goto('chrome-extension://'+loaded.id+'/panel.html');
    await panel.getByText('去看一段好视频').waitFor();
    assert.equal(await panel.locator('#error').isVisible(),false);
    await step('Panel loads without runtime errors');
    await panel.screenshot({path:path.join(root,'work/panel-empty.png')});
    const wav=Buffer.alloc(44+8000*900,128);
    wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(8000,28);wav.writeUInt16LE(1,32);wav.writeUInt16LE(8,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
    await ctx.route('https://www.youtube.com/**',async route=>{
      const url=new URL(route.request().url());
      if(url.pathname==='/fixture.wav') {
        const range=route.request().headers()['range'];
        const start=range ? Number(range.match(/bytes=(\d+)/)?.[1]||0) : 0;
        await route.fulfill({status:range?206:200,contentType:'audio/wav',headers:{'Accept-Ranges':'bytes',...(range?{'Content-Range':'bytes '+start+'-'+(wav.length-1)+'/'+wav.length}:{})},body:wav.subarray(start)});
      } else {
        const id=url.searchParams.get('v')||'dQw4w9WgXcQ';
        await route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><meta charset="UTF-8"><title>如何记下灵感：学习笔记的三个方法 - YouTube</title><ytd-watch-flexy video-id="'+id+'"><ytd-watch-metadata><h1><yt-formatted-string>如何记下灵感：学习笔记的三个方法</yt-formatted-string></h1></ytd-watch-metadata><div id="movie_player"><video controls class="html5-main-video" src="/fixture.wav" preload="auto"></video></div></ytd-watch-flexy>'});
      }
    });
    const video=await ctx.newPage();
    await video.goto('https://www.youtube.com/watch?v=dQw4w9WgXcQ',{waitUntil:'domcontentloaded'});
    await step('Fixture loaded');
    await video.waitForFunction(()=>document.querySelector('video').readyState>=1,{},{timeout:7000});
    await step('Real media ready '+await video.locator('video').evaluate(v=>v.duration));
    await video.locator('#youtube-moments #record').waitFor();
    await video.waitForFunction(()=>document.querySelector('#youtube-moments')?.shadowRoot.querySelector('#record').title.includes('按 B'));
    const readRecords=async()=> (await panel.evaluate(()=>chrome.runtime.sendMessage({type:'GET_STORE'}))).data.records;
    const countRecords=async n=>panel.waitForFunction(async n=>(await chrome.runtime.sendMessage({type:'GET_STORE'})).data.records.length===n,n);
    await video.locator('video').evaluate(v=>{v.pause();v.currentTime=120;});
    await video.keyboard.down('b');
    await countRecords(1);
    await video.keyboard.down('b');
    await video.keyboard.up('b');
    await video.waitForTimeout(150);
    assert.equal((await readRecords()).length,1);
    assert.equal((await readRecords())[0].seconds,120);
    // Native search field, contenteditable comment, ARIA textbox, and our Shadow DOM note.
    await video.evaluate(()=>{
      const field=document.createElement('input');field.id='fixture-search';document.body.append(field);
      const comment=document.createElement('div');comment.id='fixture-comment';comment.contentEditable='true';document.body.append(comment);
      const aria=document.createElement('div');aria.id='fixture-aria';aria.setAttribute('role','textbox');aria.tabIndex=0;document.body.append(aria);
    });
    for (const selector of ['#fixture-search','#fixture-comment','#fixture-aria','#youtube-moments #note']) {
      await video.locator(selector).focus();
      await video.keyboard.press('b');
    }
    await video.waitForTimeout(150);
    assert.equal((await readRecords()).length,1);
    await video.evaluate(()=>{document.activeElement.blur();document.querySelector('#youtube-moments').shadowRoot.activeElement?.blur();});
    await video.keyboard.press('Control+b');
    await video.keyboard.press('Shift+b');
    assert.equal((await readRecords()).length,1);
    await step('Single B records once; held keys, typing and modifier keys do not misfire');
    await panel.locator('#settings-toggle').click();
    await panel.locator('#single-key').selectOption('X');
    await panel.locator('#save-shortcut').click();
    await video.waitForFunction(()=>document.querySelector('#youtube-moments').shadowRoot.querySelector('#record').title.includes('按 X'));
    await video.bringToFront();
    await video.evaluate(()=>document.activeElement.blur());
    await video.keyboard.press('b');
    await video.waitForTimeout(150);
    assert.equal((await readRecords()).length,1);
    await video.keyboard.press('x');
    await countRecords(2);
    await video.reload({waitUntil:'domcontentloaded'});
    await video.waitForFunction(()=>document.querySelector('#youtube-moments')?.shadowRoot.querySelector('#record').title.includes('按 X'));
    await video.waitForFunction(()=>document.querySelector('video').readyState>=1);
    await panel.locator('#single-key-enabled').uncheck();
    await panel.locator('#save-shortcut').click();
    await video.waitForFunction(()=>document.querySelector('#youtube-moments').shadowRoot.querySelector('#record').title==='记录播放位置');
    await video.bringToFront();
    await video.keyboard.press('x');
    await video.waitForTimeout(150);
    assert.equal((await readRecords()).length,2);
    await panel.locator('#single-key-enabled').check();
    await panel.locator('#single-key').selectOption('B');
    await panel.locator('#save-shortcut').click();
    await video.waitForFunction(()=>document.querySelector('#youtube-moments').shadowRoot.querySelector('#record').title.includes('按 B'));
    await panel.screenshot({path:path.join(root,'outputs/单键设置预览.png'),fullPage:true});
    await panel.locator('#settings-toggle').click();
    for(const row of await readRecords()) await panel.evaluate(id=>chrome.runtime.sendMessage({type:'DELETE_RECORD',id}),row.id);
    await countRecords(0);
    await step('Custom X applies immediately, survives reload, and can be disabled');

    await video.locator('video').evaluate(v=>{v.pause();v.currentTime=755.4;});
    await video.locator('#youtube-moments').getByRole('button',{name:'＋ 记下此刻'}).click();
    await video.locator('#youtube-moments').getByText('✓ 已记下 12:35').waitFor();
    let state=await panel.evaluate(()=>chrome.runtime.sendMessage({type:'GET_STORE'}));
    assert.equal(state.ok,true);
    assert.equal(state.data.records[0].seconds,755);
    await step('Captured 12:35 from actual HTML media currentTime');
    const shadow=video.locator('#youtube-moments');
    await shadow.getByRole('textbox').fill('核心原理：把信息变成自己的理解。');
    await video.locator('video').evaluate(v=>v.currentTime=800);
    await shadow.getByRole('button',{name:'保存备注'}).click();
    await panel.locator('.note').filter({hasText:'核心原理'}).waitFor();
    state=await panel.evaluate(()=>chrome.runtime.sendMessage({type:'GET_STORE'}));
    assert.equal(state.data.records[0].seconds,755);
    await step('Note saved without moving saved timestamp');
    await video.bringToFront();
    const currentWindow=(await panel.evaluate(()=>chrome.windows.getCurrent())).id;
    const jump=await panel.evaluate(async ({id,windowId})=>chrome.runtime.sendMessage({type:'JUMP_RECORD',id,windowId}),{id:state.data.records[0].id,windowId:currentWindow});
    assert.equal(jump.ok,true,JSON.stringify(jump));
    assert.equal(jump.data.opened,false);
    assert.ok(Math.abs(await video.locator('video').evaluate(v=>{v.pause();return v.currentTime;})-755)<2);
    await step('Same-video click seeks the real media element');
    await video.locator('#movie_player').evaluate(p=>p.classList.add('ad-showing'));
    await shadow.getByRole('button',{name:'＋ 记下此刻'}).click();
    await shadow.getByText('正在播放广告，请在正片开始后操作。').waitFor();
    state=await panel.evaluate(()=>chrome.runtime.sendMessage({type:'GET_STORE'}));
    assert.equal(state.data.records.length,1);
    await video.locator('#movie_player').evaluate(p=>p.classList.remove('ad-showing'));
    await step('Ad recording is blocked');
    await panel.locator('#tab-all').click();
    await panel.locator('.edit').click();
    await panel.locator('#edit-note').fill('修改后的备注 <img src=x onerror=alert(1)>');
    await panel.locator('#edit-save').click();
    await panel.locator('.note').filter({hasText:'修改后的备注'}).waitFor();
    assert.equal(await panel.locator('.note img').count(),0);
    await panel.locator('#search').fill('不存在的词');
    assert.equal(await panel.locator('.moment').count(),0);
    await panel.locator('#search').fill('修改后的备注');
    assert.equal(await panel.locator('.moment').count(),1);
    await panel.locator('#search').fill('');
    await step('Edit, search and safe text rendering pass');
    await panel.locator('.delete').click();
    await panel.getByText('你的收藏，从一刻开始').waitFor();
    await panel.locator('#undo').click();
    await panel.locator('.moment').waitFor();
    await step('Delete and undo restore the record');
    await panel.locator('#settings-toggle').click();
    const downloadPromise=panel.waitForEvent('download');
    await panel.locator('#export-json').click();
    const download=await downloadPromise;
    const backupPath=path.join(root,'work/roundtrip.json');
    await download.saveAs(backupPath);
    const backup=await fs.readFile(backupPath,'utf8');
    assert.equal(JSON.parse(backup).records.length,1);
    await panel.locator('#import-file').setInputFiles(backupPath);
    await panel.getByText('已导入 0 条，跳过 1 条重复记录').waitFor();
    assert.equal(await panel.locator('.moment').count(),1);
    await panel.locator('#import-file').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"schemaVersion":1,"records":[{}]}')});
    await panel.locator('#error').waitFor();
    assert.equal(await panel.locator('.moment').count(),1);
    await step('JSON download, duplicate merge and invalid-file rejection pass');
    const mdPromise=panel.waitForEvent('download');
    await panel.locator('#export-md').click();
    const md=await mdPromise;
    await md.saveAs(path.join(root,'work/notes.md'));
    assert.ok((await fs.readFile(path.join(root,'work/notes.md'),'utf8')).includes('&t=755s'));
    await panel.reload();
    await panel.locator('#tab-all').click();
    await panel.locator('.moment').waitFor();
    await step('Markdown links and reload persistence pass');
    // Seed a few explicit demo notes for the screenshot; this profile is disposable.
    const now='2026-10-27T03:00:00.000Z';
    const demo={schemaVersion:1,records:[{id:'demo-1',videoId:'dQw4w9WgXcQ',title:'如何记下灵感：学习笔记的三个方法',seconds:132,note:'先抓住问题，再记录答案。',createdAt:now,updatedAt:now},{id:'demo-2',videoId:'dQw4w9WgXcQ',title:'如何记下灵感：学习笔记的三个方法',seconds:512,note:'用自己的话复述，比原封不动地摘抄更有用。',createdAt:now,updatedAt:now}]};
    await panel.evaluate(text=>chrome.runtime.sendMessage({type:'IMPORT_BACKUP',text}),JSON.stringify(demo));
    await panel.locator('#tab-all').click();
    await panel.waitForFunction(()=>document.querySelectorAll('.moment').length===3);
    state=await panel.evaluate(()=>chrome.runtime.sendMessage({type:'GET_STORE'}));
    const first=state.data.records.find(r=>r.seconds===755);
    await panel.evaluate(({id})=>chrome.runtime.sendMessage({type:'UPDATE_NOTE',id,note:'这里解释了核心原理。回看时，从这个例子开始。'}),first);
    await video.bringToFront();
    await panel.waitForFunction(()=>document.querySelector('#current-title').textContent.includes('学习笔记'));
    await panel.evaluate(()=>document.querySelector('#tab-current').click());
    await panel.waitForFunction(()=>document.querySelectorAll('.moment').length===3);
    await panel.screenshot({path:path.join(root,'outputs/界面预览.png'),fullPage:true});
    await panel.setViewportSize({width:300,height:750});
    assert.equal(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await panel.setViewportSize({width:380,height:860});
    await step('Narrow panel layout has no horizontal overflow');
    await panel.evaluate(()=>document.querySelector('#record').click());
    await panel.locator('#edit-dialog').waitFor();
    await panel.locator('#edit-note').fill('从面板保存的备注');
    await panel.locator('#edit-save').click();
    state=await panel.evaluate(()=>chrome.runtime.sendMessage({type:'GET_STORE'}));
    assert.ok(state.data.records.some(r=>r.note==='从面板保存的备注'));
    await step('Panel record button and optional-note dialog pass');
    const concurrent=await panel.evaluate(async now=>{
      return Promise.all(Array.from({length:12},(_,i)=>chrome.runtime.sendMessage({type:'IMPORT_BACKUP',text:JSON.stringify({schemaVersion:1,records:[{id:'parallel-'+i,videoId:'bbbbbbbbbbb',title:'并发写入测试',seconds:i,note:'test '+i,createdAt:now,updatedAt:now}]})})));
    },now);
    assert.ok(concurrent.every(r=>r.ok));
    state=await panel.evaluate(()=>chrome.runtime.sendMessage({type:'GET_STORE'}));
    assert.equal(state.data.records.filter(r=>r.id.startsWith('parallel-')).length,12);
    await step('Concurrent storage writes preserve every record');
    // Switching a video's URL without a full reload must change ownership.
    await video.evaluate(()=>{
      document.dispatchEvent(new Event('yt-navigate-start'));
      history.pushState({},'', '/watch?v=aaaaaaaaaaa');
      document.querySelector('ytd-watch-flexy').setAttribute('video-id','aaaaaaaaaaa');
      document.dispatchEvent(new Event('yt-navigate-finish'));
      document.querySelector('video').currentTime=42;
    });
    await video.bringToFront();
    await shadow.getByRole('button',{name:'＋ 记下此刻'}).click();
    state=await panel.evaluate(()=>chrome.runtime.sendMessage({type:'GET_STORE'}));
    assert.ok(state.data.records.some(r=>r.videoId==='aaaaaaaaaaa'&&r.seconds===42));
    const pagePromise=ctx.waitForEvent('page');
    const result=await panel.evaluate(async ({id,windowId})=>chrome.runtime.sendMessage({type:'JUMP_RECORD',id,windowId}),{id:state.data.records.find(r=>r.videoId==='dQw4w9WgXcQ').id,windowId:currentWindow});
    assert.equal(result.ok,true,JSON.stringify(result));
    assert.equal(result.data.opened,true);
    const opened=await pagePromise;
    await opened.waitForURL('**/watch?v=dQw4w9WgXcQ&t=755s');
    await step('SPA video ownership and cross-video timestamp URL pass');
    assert.deepEqual(errors,[]);
    await step('PASS: no uncaught page errors');
    return {passed:lines.length,log:lines};
  } catch(error) {
    await step('FAIL: '+error.stack);
    throw error;
  } finally { await ctx.close(); }
};

if (require.main === module) {
  const pw = require('playwright');
  const root = path.resolve(__dirname, '..', '.test-artifacts');
  Promise.all(['work','outputs','work/downloads'].map(dir=>fs.mkdir(path.join(root,dir),{recursive:true})))
    .then(()=>exports.run({pw,root,browserPath:process.env.BROWSER_EXECUTABLE || pw.chromium.executablePath(),log:console.log}))
    .then(result=>console.log(JSON.stringify(result,null,2)))
    .catch(error=>{console.error(error);process.exitCode=1;});
}
