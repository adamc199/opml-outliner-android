/**
 * Publishing to adam.curry.com through cartpub on helix — the screens, shared by the desktop OPML Outliner
 * (outliner/app.js) and the Android app (copied in by its build.sh). Each app hands in `api`, its own way to reach
 * cartpub and files: { cartGet, cartPost, cartUpload, savePublished, markPublished, openExternal, fetchUrl }.
 * Adam, 2026-10-21: cart.curry.com is retired; "I like Plan B a lot with our own outliner". The dialogs live in the
 * app's index.html (#pubdlg, #pickdlg, #askdlg) with the app's own look.
 */
export function initPublishing({ outliner, askText, say, report, api }) {
const $ = s => document.querySelector(s);
const NA_TITLE = /^No Agenda Episode (\d+) - "/;
const fmtDate = t => new Date(t * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const pageLabel = f => `${f.title || f.file}  ·  ${fmtDate(f.time)}`;

async function publish() {
  if (!outliner.hasDoc()) return say('open an outline first', true);
  const list = await api.cartGet('/api/published?limit=400');
  if (list.error) return say(`publish: ${list.error}`, true);
  const st = outliner.publishState();
  const p = outliner.path() || '';
  const title0 = outliner.docTitle() || p.split('/').pop().replace(/\.opml$/i, '');
  const sel = $('#pub-page');
  sel.innerHTML = '';
  sel.append(new Option('New page (a new address)', ''));
  for (const f of list.files) sel.append(new Option(pageLabel(f), f.file));
  $('#pub-title').value = title0;
  // The page this outline was published to last time; else one already published under the same title
  const same = list.files.find(f => f.file === st.file) || list.files.find(f => f.title && f.title === title0);
  // published before but not in the list (yet): still offer it, so an update never mints a new address
  const pinned = same ? same.file : (st.file || '');
  if (pinned && ![...sel.options].some(o => o.value === pinned)) sel.append(new Option(`${title0}  ·  published before`, pinned));
  sel.value = pinned;
  const na = title0.match(NA_TITLE);
  $('#pub-redirect').value = st.redirect || (na ? `${na[1]}.noagendanotes.com` : '');
  $('#pub-archive').checked = !!na;
  const note = () => {
    const t = $('#pub-title').value.trim(), upd = sel.value;
    $('#pub-archive').disabled = !NA_TITLE.test(t);
    if (!NA_TITLE.test(t)) $('#pub-archive').checked = false;
    $('#pub-note').className = 'note' + (upd ? '' : ' warn');
    $('#pub-note').textContent = upd
      ? `UPDATES the page at the same address:\nhttp://adam.curry.com/html/${upd.replace(/\.opml$/, '.html')}`
      : 'Makes a NEW page with a new address. To change a page you published before, choose it under Page.';
  };
  $('#pub-title').oninput = note; sel.onchange = note; note();
  $('#pub-result').hidden = true; $('#pub-ok').hidden = false; $('#pub-ok').disabled = false; $('#pub-cancel').textContent = 'Cancel';
  const dlg = $('#pubdlg');
  dlg.returnValue = '';
  dlg.showModal();
  const ok = await new Promise(res => {
    $('#pub-ok').onclick = e => { e.preventDefault(); res(true); };
    dlg.onclose = () => res(false);
  });
  if (!ok) return;
  const title = $('#pub-title').value.trim();
  if (!title) { dlg.close(); return say('publish: a title is needed', true); }
  const file = sel.value, redirect = $('#pub-redirect').value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  $('#pub-ok').disabled = true; $('#pub-note').className = 'note'; $('#pub-note').textContent = 'Publishing…';
  outliner.preparePublish({ file, redirect });
  if (!(await outliner.save())) { dlg.close(); return say('publish: the outline could not be saved first - nothing was published', true); }
  const r = await api.cartPost('/api/publish', { xml: outliner.publishXml(), title, pin: file,
    redirect, archive: $('#pub-archive').checked });
  if (r.error) {   // one try per dialog: Close, fix, Publish again
    $('#pub-note').className = 'note warn'; $('#pub-note').textContent = `NOT published: ${r.error}`;
    $('#pub-ok').hidden = true; $('#pub-cancel').textContent = 'Close'; return say(`publish failed: ${r.error}`, true);
  }
  // remember the page, so the next Publish updates it
  if (r.filename !== file) { outliner.preparePublish({ file: r.filename, redirect }); await outliner.save(); }
  await api.markPublished(outliner.path());   // the copy on disk = what is on adam.curry.com
  report();
  $('#pub-note').textContent = 'Published.';
  const res = $('#pub-result');
  res.innerHTML = '';
  const link = (label, u) => { const d = document.createElement('div'); d.append(label + ' ');
    const a = document.createElement('a'); a.href = '#'; a.textContent = u; a.onclick = e => { e.preventDefault(); api.openExternal(u); };
    d.append(a); res.append(d); };
  link('Page:', r.html_url.replace(/^http:/, 'https:'));
  if (r.redirect_url) link('Show link:', r.redirect_url);
  if (r.archive) { const d = document.createElement('div'); d.textContent = `Archive: ${r.archive.startsWith('already') ? 'the show was already on it' : 'added'}`; res.append(d); }
  const d = document.createElement('div');
  d.textContent = /^cleared/.test(r.cache || '') ? 'The update shows within about a minute (cache cleared).'
    : /^NOT/.test(r.cache || '') ? `Cache not cleared: the update shows within 5 minutes. (${r.cache})` : '';
  if (d.textContent) res.append(d);
  res.hidden = false; $('#pub-ok').hidden = true; $('#pub-cancel').textContent = 'Close';
  try { await navigator.clipboard.writeText(r.html_url); } catch {}
  say(`published: ${r.html_url}`);
}

async function openPublished() {
  const list = await api.cartGet('/api/published?limit=2000');
  if (list.error) return say(`open published: ${list.error}`, true);
  const dlg = $('#pickdlg'), sel = $('#pick-list'), filt = $('#pick-filter');
  $('#pick-title').textContent = 'Open a published page'; filt.hidden = false; $('#pick-ok').textContent = 'Open';
  const fill = () => { const q = filt.value.toLowerCase(); sel.innerHTML = '';
    for (const f of list.files) if (!q || (f.title + ' ' + f.file).toLowerCase().includes(q)) sel.append(new Option(pageLabel(f), f.file));
    if (sel.options.length) sel.selectedIndex = 0; };
  filt.value = ''; filt.oninput = fill; fill();
  sel.ondblclick = () => dlg.close('ok');
  filt.onkeydown = e => { if (e.key === 'ArrowDown') { e.preventDefault(); sel.focus(); } };
  dlg.returnValue = '';
  dlg.showModal(); filt.focus();
  await new Promise(res => { dlg.onclose = res; });
  if (dlg.returnValue !== 'ok' || !sel.value) return;
  const f = list.files.find(x => x.file === sel.value);
  const r = await api.cartGet(`/api/opml?file=${encodeURIComponent(f.file)}`);
  if (r.error) return say(`open published: ${r.error}`, true);
  // mark which page it came from, so Publish updates that page (same address)
  // the page's own open sections (expansionState) decide the shape; drop editor bookkeeping a page may carry
  let xml = r.xml.replace(/ _expanded="true"/g, '').replace(/\s*<state [^>]*\/>/g, '');
  const tag = `<publish file="${f.file}"/>`;
  xml = /<\/head>/.test(xml) ? xml.replace(/<\/head>/, `\t${tag}\n\t\t</head>`) : xml;
  await api.savePublished(f.file, xml);
}

async function setLineType(t) {
  const now = outliner.nodeType();
  if (now === null) return say('select a line first', true);
  let url;
  if (t === 'link' || t === 'redirect') {
    url = await askText({ title: 'What url to point to?', ok: 'OK' });
    if (url == null) return;
  } else if ((t === 'image' || t === 'enclosure') && !outliner.hasUrl() && !outliner.urlInText()) {
    url = await askText({ title: t === 'image' ? 'What is the url of the image?' : 'What is the url of the enclosure?', ok: 'OK' });
    if (url == null) return;
  } else if (t === 'include') return include();
  outliner.setType(t, url);
  report();
}

async function include() {
  if (outliner.nodeType() === null) return say('select a line first', true);
  const u = await askText({ title: 'Include an outline', note: "The address of an OPML outline (for example one of your published pages' .opml). Its lines go under the selected line.", ok: 'Include' });
  if (!u) return;
  const r = await api.fetchUrl(u);
  if (r.error) return say(`include failed: ${r.error}`, true);
  const err = outliner.setInclude(u, r.xml);
  if (err) say(`include failed: ${err}`, true); else report();
}

async function attach() {
  if (!outliner.hasDoc()) return say('open an outline first', true);
  say('attach: uploading…');
  const r = await api.cartUpload();
  if (!r) return;
  if (r.error) return say(`attach failed: ${r.error}`, true);
  outliner.insertMedia(r);
  report();
  say(`attached: ${r.url}`);
}

// The line types as a list to tap (the Android app has no menu bar; the desktop has Publish > Line Type)
const TYPES = [['none', 'Not set'], ['outline', 'Outline'], ['document', 'Document'], ['index', 'Index'], ['html', 'Html'],
  ['collaborate', 'Collaborate'], ['presentation', 'Presentation'], ['redirect', 'Redirect'], ['tabs', 'Tabs'], ['menu', 'Menu'],
  ['link', 'Link'], ['include', 'Include'], ['image', 'Image'], ['code', 'Code']];
async function chooseLineType() {
  const now = outliner.nodeType();
  if (now === null) return say('select a line first', true);
  const dlg = $('#pickdlg'), sel = $('#pick-list');
  $('#pick-title').textContent = 'Line type'; $('#pick-filter').hidden = true; $('#pick-ok').textContent = 'Set';
  sel.innerHTML = '';
  for (const [t, l] of TYPES) sel.append(new Option(l + (t === (now || 'none') ? '  ✓' : ''), t));
  sel.value = now || 'none';
  sel.ondblclick = () => dlg.close('ok');
  dlg.returnValue = ''; dlg.showModal();
  await new Promise(res => { dlg.onclose = res; });
  $('#pick-filter').hidden = false; $('#pick-title').textContent = 'Open a published page'; $('#pick-ok').textContent = 'Open';
  if (dlg.returnValue === 'ok' && sel.value) await setLineType(sel.value);
}
return { publish, openPublished, setLineType, chooseLineType, include, attach };
}

// "Edits" for the unpublished-changes question: the editor's bookkeeping (selection, open/shut, which page) is not one.
export const sameOutline = x => x.replace(/<state [^>]*\/>/g, '').replace(/ _expanded="true"/g, '').replace(/<publish [^>]*\/>/g, '')
  .replace(/<expansionState>[^<]*<\/expansionState>/g, '').replace(/\s+/g, ' ');
