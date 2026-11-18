// Headless phone-size run of the Android app's page (assets/) with the mock bridge. Prints ok/FAIL lines.
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
const ASSETS = path.join(__dirname, '..', 'app', 'src', 'main', 'assets');
const GCFILE = process.env.GCFILE;
app.whenReady().then(async () => {
  // test page = the real index.html with the mock bridge loaded first
  const html = fs.readFileSync(path.join(ASSETS, 'index.html'), 'utf8').replace('<script type="module" src="app.js">', '<script src="../../../../test/mock-android.js"></script><script type="module" src="app.js">');
  const page = path.join(ASSETS, '__test.html'); fs.writeFileSync(page, html);
  const win = new BrowserWindow({ width: 412, height: 860, show: false, webPreferences: { offscreen: true, webSecurity: false } });
  let failed = 0; const check = (c, w) => { console.log(`  ${c ? 'ok  ' : 'FAIL'}  ${w}`); if (!c) failed++; };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const js = c => win.webContents.executeJavaScript(c).catch(e => 'JSERR ' + e.message);
  await win.loadFile(page); win.webContents.focus(); await wait(1200);
  // 1. start: no last file -> the Files screen, with godcaster's recent list from the real service
  check(await js(`!document.querySelector('#files').hidden`), 'first start shows the Files screen');
  const gc = await js(`[...document.querySelectorAll('#gclist .frow b')].map(b => b.textContent)`);
  check(Array.isArray(gc) && gc.includes('NA-9999-phone.opml'), `godcaster's recent outlines are listed (${gc})`);
  // 2. open the godcaster outline
  await js(`[...document.querySelectorAll('#gclist .frow')].find(r => /NA-9999-phone/.test(r.textContent)).click(); true`); await wait(800);
  check(await js(`document.querySelector('#files').hidden && document.querySelectorAll('#otree .oline').length > 0`), 'tapping it opens it in the editor');
  check(await js(`document.querySelector('#fname').textContent + ' | ' + document.querySelector('#where').textContent`) === 'NA-9999-phone.opml | godcaster', 'header names the file and "godcaster"');
  const txt = () => js(`[...document.querySelectorAll('#otree .otx')].map(x => x.textContent)`);
  check((await txt()).includes('Kid one') && !(await txt()).includes('hidden kid'), "the desktop's saved open/closed state is used");
  // 3. touch: tap selects, double-tap opens/closes, long-press edits
  const line = t => `[...document.querySelectorAll('#otree .oline')].find(x => x.querySelector('.otx')?.textContent === ${JSON.stringify(t)})`;
  await js(`${line('Shut parent')}.dispatchEvent(new MouseEvent('click', {bubbles:true})); true`); await wait(150);
  check(await js(`${line('Shut parent')}.classList.contains('sel')`), 'tap selects a line');
  await js(`${line('Shut parent')}.dispatchEvent(new MouseEvent('dblclick', {bubbles:true})); true`); await wait(200);
  check((await txt()).includes('hidden kid') && await js(`!document.querySelector('#otree .oedit')`), 'double-tap opens it, no editing');
  await js(`${line('Shut parent')}.dispatchEvent(new MouseEvent('dblclick', {bubbles:true})); true`); await wait(200);
  check(!(await txt()).includes('hidden kid'), 'double-tap again closes it');
  await js(`${line('Kid one')}.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true})); true`); await wait(250);
  check(await js(`!!document.querySelector('#otree .oedit')`), 'long-press edits the line');
  await js(`(() => { const i = document.querySelector('#otree .oedit'); i[i.isContentEditable ? 'textContent' : 'value'] = 'Kid one (phone)'; i.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true})); return true; })()`); await wait(250);
  check((await txt()).includes('Kid one (phone)') && await js(`window.__outlinerApp.dirty()`), 'Enter on the keyboard keeps the edit');
  // 4. toolbar: new line, indent, move, undo
  await js(`document.querySelector('#tnew').click(); true`); await wait(250);
  check(await js(`!!document.querySelector('#otree .oedit')`), '＋ makes a new line and opens it for typing');
  await js(`(() => { const i = document.querySelector('#otree .oedit'); i[i.isContentEditable ? 'textContent' : 'value'] = 'typed on phone'; i.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true})); return true; })()`); await wait(250);
  const depth = t => js(`(() => { const l = ${line(t)}; return l ? parseInt(l.style.marginLeft) : null; })()`);
  const d0 = await depth('typed on phone'); await js(`document.querySelector('#tin').click(); true`); await wait(200);
  check(await depth('typed on phone') > d0, `⇥ indents (${d0} -> ${await depth('typed on phone')})`);
  await js(`document.querySelector('#tout').click(); true`); await wait(200);
  check(await depth('typed on phone') === d0, '⇤ outdents');
  const pos = () => js(`(await => [...document.querySelectorAll('#otree .otx')].map(x => x.textContent).indexOf('typed on phone'))()`);
  const p0 = await pos(); await js(`document.querySelector('#tup').click(); true`); await wait(200);
  check(await pos() === p0 - 1, '↑ moves the line up');
  await js(`document.querySelector('#tundo').click(); true`); await wait(200);
  check(await pos() === p0, '↶ undoes');
  // 5. Save writes to godcaster through the service, with a backup
  await js(`document.querySelector('#osave').click(); true`); await wait(800);
  const disk = fs.readFileSync(GCFILE, 'utf8');
  check(/Kid one \(phone\)/.test(disk) && /typed on phone/.test(disk) && /_custom="keep"/.test(disk), 'Save writes the edits into the file on godcaster; unknown attributes kept');
  check(fs.readdirSync(process.env.BACKUPS).length >= 1, 'the godcaster service made a backup first');
  check(await js(`!window.__outlinerApp.dirty() && document.querySelector('#osave').textContent === 'Saved'`), 'the Save button turns back to "Saved"');
  // 6. godcaster file changed by the desktop meanwhile -> conflict bar, nothing overwritten
  fs.writeFileSync(GCFILE, fs.readFileSync(GCFILE, 'utf8').replace('typed on phone', 'desktop changed it'));
  const t = new Date(Date.now() + 4000); fs.utimesSync(GCFILE, t, t);
  await js(`document.querySelector('#tnew').click(); true`); await wait(200);
  await js(`(() => { const i = document.querySelector('#otree .oedit'); i[i.isContentEditable ? 'textContent' : 'value'] = 'late phone edit'; i.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true})); return true; })()`); await wait(200);
  await js(`window.__saveNow(); true`); await wait(800);
  check(/desktop changed it/.test(fs.readFileSync(GCFILE, 'utf8')) && await js(`!!document.querySelector('#oconflict')`), 'leaving the app saves; a file the desktop changed meanwhile is not overwritten, the conflict bar asks');
  // 6b. opening another file with unsaved changes is refused WITH a message; the bar's button resolves it
  await js(`document.querySelector('#bfiles').click(); true`); await wait(500);
  await js(`document.querySelector('#fopen').click(); true`); await wait(600);
  check(await js(`document.querySelector('#where').textContent`) === 'godcaster' && await js(`/not saved yet/.test(document.querySelector('#oalert')?.textContent || '')`),
        'unsaved changes block switching files, and the app says why');
  await js(`[...document.querySelectorAll('#oconflict button')].find(b => /disk/.test(b.textContent)).click(); true`); await wait(800);
  check((await txt()).includes('desktop changed it') && !(await js(`window.__outlinerApp.dirty()`)), '"Load the version on disk" shows the desktop\'s version');
  // 7. this phone's files
  await js(`document.querySelector('#bfiles').click(); true`); await wait(600);
  await js(`document.querySelector('#fopen').click(); true`); await wait(800);
  check(await js(`document.querySelector('#where').textContent`) === 'this phone' && (await txt()).includes('phone line'), 'Open a file… opens a phone file');
  await js(`(() => { ${line('phone line')}.click(); return true; })()`); await wait(100);
  await js(`document.querySelector('#tedit').click(); true`); await wait(200);
  await js(`(() => { const i = document.querySelector('#otree .oedit'); i[i.isContentEditable ? 'textContent' : 'value'] = 'phone line edited'; i.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true})); return true; })()`); await wait(200);
  await js(`document.querySelector('#osave').click(); true`); await wait(400);
  check(await js(`window.__mock.phone['content://phone/Notes.opml'].xml.includes('phone line edited')`), 'Save writes the phone file');
  await js(`document.querySelector('#bfiles').click(); true`); await wait(600);
  check(await js(`[...document.querySelectorAll('#locallist .frow b')].map(b => b.textContent).includes('Notes.opml')`), '"This phone" lists the phone file');
  check(await js(`window.__back()`) === true && await js(`document.querySelector('#files').hidden`), 'Back closes the Files screen first');
  // 8. scroll past the end and phone width
  // 7. publishing to adam.curry.com (the desktop's screens, outliner-publish.js) against a dry cartpub
  const until = async (c, ms = 20000) => { for (let t = 0; t < ms; t += 200) { if (await js(c)) return true; await wait(200); } return false; };
  await js(`document.querySelector('#bfiles').click(), true`); await wait(600);
  await js(`document.querySelector('#fpublished').click(), true`);
  check(await until(`document.querySelector('#pickdlg').open && document.querySelector('#pick-list').options.length > 10`), 'Files → "Open a published page…" lists the pages');
  await js(`(() => { const f = document.querySelector('#pick-filter'); f.value = 'Meat Muck'; f.dispatchEvent(new Event('input')); document.querySelector('#pickdlg').close('ok'); return true; })()`);
  check(await until(`document.querySelector('#where').textContent === 'adam.curry.com'`), 'it opens straight in the editor, no save dialog; header says "adam.curry.com"');
  check(await js(`document.querySelector('#fname').textContent`) === 'NoAgendaEpisode1913M-S1phVXeyQY2eoxRwz0Fdhx.opml' && await js(`document.querySelectorAll('#otree .oline').length`) > 0, 'NA-1913 is open');
  await js(`document.querySelector('#otree .oline').click(), true`); await wait(200);
  await js(`document.querySelector('#ttype').click(), true`);
  check(await until(`document.querySelector('#pickdlg').open && document.querySelector('#pick-list').options.length === 14`), 'Type shows cart\'s 14 line types');
  await js(`(() => { document.querySelector('#pick-list').value = 'tabs'; document.querySelector('#pickdlg').close('ok'); return true; })()`); await wait(400);
  check(/type="tabs"/.test(await js(`window.__outline.xml()`)), 'choosing Tabs sets the line type');
  await js(`document.querySelector('#tattach').click(), true`);
  check(await until(`/noagendaassets\.com\/enc\/[0-9.]+_0910-phoneclip\.mp3/.test(window.__outline.xml())`), 'Attach uploads (dry) and adds the audio line with the asset address');
  await js(`document.querySelector('#tpublish').click(), true`);
  check(await until(`document.querySelector('#pubdlg').open && document.querySelector('#pub-page').options.length > 10`), 'Publish opens the dialog');
  check(await js(`document.querySelector('#pub-page').value`) === 'NoAgendaEpisode1913M-S1phVXeyQY2eoxRwz0Fdhx.opml', 'it updates the page it was opened from (same address)');
  await js(`(() => { document.querySelector('#pub-redirect').value = ''; document.querySelector('#pub-archive').checked = false; document.querySelector('#pub-ok').click(); return true; })()`);
  check(await until(`!document.querySelector('#pub-result').hidden || /NOT published/.test(document.querySelector('#pub-note').textContent)`, 60000)
        && /NoAgendaEpisode1913M-S1phVXeyQY2eoxRwz0Fdhx\.html/.test(await js(`document.querySelector('#pub-result').textContent`)), `published (${(await js(`document.querySelector('#pub-note').textContent`)).slice(0, 80)})`);
  check(await js(`document.documentElement.scrollWidth <= 412`), 'the Publish dialog fits the phone');
  await js(`document.querySelector('#pubdlg').close(), true`); await wait(300);
  await js(`document.querySelector('#bfiles').click(), true`); await wait(400);
  await js(`document.querySelector('#fpublished').click(), true`);
  await until(`document.querySelector('#pickdlg').open && document.querySelector('#pick-list').options.length > 10`);
  await js(`(() => { const f = document.querySelector('#pick-filter'); f.value = 'Meat Muck'; f.dispatchEvent(new Event('input')); document.querySelector('#pickdlg').close('ok'); return true; })()`); await wait(1500);
  check(await js(`!document.querySelector('#askdlg').open && /0910-phoneclip/.test(window.__outline.xml())`), 'opened again after publishing: no question, the published copy');

  // ---- Picture (2026-11-18): from the phone, inserted, shown in the editor, scaled on the pages
  await js(`document.querySelector('#tpicture').click(), true`);
  check(await until(`[...new DOMParser().parseFromString(window.__outline.xml(), 'text/xml').querySelectorAll('outline[type=image]')].some(o => /2041\.jpg$/i.test(o.getAttribute('url') || ''))`), 'Picture uploads (dry) and adds an Image line');
  check(/max-width:600px/.test(await js(`window.__outline.xml()`)), 'the picture is 600 px at most and scales down on a phone (width:100%)');
  // the dry upload's address does not exist, so it falls back to its name; a real picture (NA-1913 art) must show as a picture
  await js(`window.__outlinerApp.insertMedia({ url: 'https://noagendaassets.com/enc/1792359403.735_na-1913-art-sm.jpg', name: 'art', type: 'image/jpeg', length: 1 }), true`);
  check(await until(`[...document.querySelectorAll('#otree img')].some(i => /na-1913-art-sm/.test(i.src) && i.complete && i.naturalWidth > 0)`, 20000), 'the editor shows a picture line as the picture');
  check(await js(`[...document.querySelectorAll('#otree .oline')].some(l => /2041/.test(l.textContent) && !l.querySelector('img'))`), "a picture that can't load shows its file name instead");
  check(await js(`[...document.querySelectorAll('#otree img')].every(i => i.getBoundingClientRect().width <= 412)`), 'pictures in the editor fit the phone');
  // ---- Markdown (2026-11-18): the converter, Save to phone, Publish to adam.curry.com/md/ (dry cartpub)
  const conv = await js(`window.__markdown.opmlToMarkdown('<?xml version="1.0"?><opml version="2.0"><head><title>T</title></head><body>' +
    '<outline text="A plain &lt;b&gt;bold&lt;/b&gt; paragraph with &lt;a href=&quot;https://x.org/&quot;&gt;a link&lt;/a&gt;."/>' +
    '<outline text="Topic"><outline text="first"><outline text="deeper"/></outline><outline text="Site" type="link" url="https://y.org/"/></outline>' +
    '<outline text="secret" isComment="true"/><outline text="pic" type="image" url="https://z.org/p.png"/>' +
    '<outline text="&lt;script&gt;alert(1)&lt;/script&gt;Safe text"/></body></opml>').markdown`);
  check(/^A plain \*\*bold\*\* paragraph with \[a link\]\(https:\/\/x\.org\/\)\./.test(conv), 'Markdown: a line with no children is a paragraph, HTML becomes **bold** and [link](url)');
  check(/## Topic\n\n- first\n  - deeper\n- \[Site\]\(https:\/\/y\.org\/\)/.test(conv), 'a line with children is a ## heading with its lines as a nested list; Link lines become links');
  check(!/secret/.test(conv) && /!\[pic\]\(https:\/\/z\.org\/p\.png\)/.test(conv) && !/script|alert/.test(conv) && /Safe text/.test(conv), 'comments left out, Image lines are pictures, script tags dropped');
  await js(`document.querySelector('#tmd').click(), true`);
  check(await until(`document.querySelector('#mddlg').open && document.querySelector('#md-preview').textContent.length > 100`), `Markdown opens the dialog with a preview (${(await js(`document.querySelector('#md-preview').textContent.length`))} chars)`);
  await js(`document.querySelector('#md-save').click(), true`);
  check(await until(`/^---\ntitle: /.test(window.__mock.st.saved?.text || '') && /\.md$/.test(window.__mock.st.saved.name) && window.__mock.st.saved.mime === 'text/markdown'`), `Save to phone… writes a .md file with front matter (${await js(`window.__mock.st.saved?.name`)})`);
  await js(`document.querySelector('#md-pub').click(), true`);
  check(await until(`!document.querySelector('#md-result').hidden`, 60000) && /https:\/\/adam\.curry\.com\/md\/\d{4}\/\d{2}\/\d{2}\/[A-Za-z0-9-]+\.md/.test(await js(`document.querySelector('#md-result').textContent`)),
        `Publish makes a post on today's page (${(await js(`document.querySelector('#md-note').textContent`)).slice(0, 70)})`);
  const mdid = await js(`Object.values(window.__mock.st.prefs || {})[0] || ''`);
  const toc = path.join(process.env.OUTDIR, 'cartpub', 'md-dry', 'site', '.well-known', 'toc.opml');
  check(fs.existsSync(toc) && fs.readFileSync(toc, 'utf8').includes('type="calendarDay"') && fs.readFileSync(toc, 'utf8').includes(mdid.slice(0, 10) + '.md'), `the site's calendar (toc.opml) lists the day (${mdid})`);
  await js(`document.querySelector('#mddlg').close(), true`); await wait(200);
  await js(`document.querySelector('#tmd').click(), true`); await until(`document.querySelector('#mddlg').open`);
  check(/UPDATES the post at:\nhttps:\/\/adam\.curry\.com\/md\//.test(await js(`document.querySelector('#md-note').textContent`)) && await js(`!document.querySelector('#md-newrow').hidden`), 'opened again: it updates the same post (or tick "new post")');
  await js(`document.querySelector('#md-pub').click(), true`);
  await until(`!document.querySelector('#md-result').hidden`, 60000);
  check((await js(`Object.values(window.__mock.st.prefs || {})[0]`)) === mdid, 'republish keeps the same address');
  check(await js(`document.documentElement.scrollWidth <= 412`), 'the Markdown dialog fits the phone');
  await js(`document.querySelector('#mddlg').close(), true`); await wait(200);

  await js(`(() => { const t = document.querySelector('#otree'); t.scrollTop = t.scrollHeight; return true; })()`); await wait(200);
  const top = await js(`(() => { const t = document.querySelector('#otree'), ls = t.querySelectorAll('.oline'); return Math.round(ls[ls.length-1].getBoundingClientRect().top - t.getBoundingClientRect().top); })()`);
  check(top < 60, `scrolls past the end on the phone too (${top}px)`);
  check(await js(`document.documentElement.scrollWidth <= 412`), 'nothing wider than the phone');
  const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(process.env.OUTDIR, 'phone.png'), img.toPNG());
  fs.unlinkSync(page);
  console.log(`DRIVER done — ${failed} failed`); app.exit(failed ? 1 : 0);
});
