// OPML Outliner for Android: CurryCaster II's outline editor (outliner.js, copied from
// the desktop outliner's renderer by build.sh) with the phone's files and godcaster's recent outlines.
import { initOutliner, openOutline, outliner } from './outliner.js';
import { initPublishing, sameOutline } from './outliner-publish.js';   // both copied from studiocast2 by build.sh
import { opmlToMarkdown } from './outliner-markdown.js';             // this app's own (Adam 2026-11-18: save + publish as Markdown)
const $ = s => document.querySelector(s);

/* ---- the bridge to the Android side (Bridge.kt): Android.call(id, method, arg) -> window.__resolve(id, json) */
const waiting = {}; let seq = 0;
window.__resolve = (id, json) => { const f = waiting[id]; delete waiting[id]; if (f) f(json === 'null' ? null : JSON.parse(json)); };
const call = (method, arg) => new Promise(r => { const id = 'c' + (++seq); waiting[id] = r; window.Android.call(id, method, arg ? JSON.stringify(arg) : ''); });
// the four file operations the editor expects (window.studiocast.opml, as in CurryCaster II)
window.studiocast = { opml: {
  read: rel => call('read', { abs: rel.abs }),
  choose: () => call('choose'),
  create: () => call('create'),
  save: o => call('save', o),
} };

function askText({ title, note = '', value = '', ok = 'OK', multiline = false, confirm = false, cancel = 'Cancel' }) {
  return new Promise(resolve => {
    const dlg = $('#askdlg'), box = multiline ? $('#ask-area') : $('#ask-value');
    $('#ask-title').textContent = title; $('#ask-note').textContent = note; $('#ask-note').hidden = !note;
    $('#ask-value').hidden = multiline || confirm; $('#ask-area').hidden = !multiline || confirm;
    box.value = value; $('#ask-ok').textContent = ok; $('#ask-cancel').textContent = cancel; dlg.returnValue = '';
    const done = () => { dlg.removeEventListener('close', done); resolve(dlg.returnValue === 'ok' ? (multiline ? box.value : box.value.trim()) : null); };
    dlg.addEventListener('close', done); dlg.showModal(); if (!confirm) box.focus();
  });
}
const say = (t, bad) => { if (bad) { let b = $('#oalert'); if (!b) { b = document.createElement('div'); b.id = 'oalert'; b.className = 'oconflict'; $('#otree').before(b); }
  b.textContent = t; clearTimeout(b._t); b._t = setTimeout(() => b.remove(), 8000); } };

initOutliner({ log: say, ask: askText, standalone: true });
window.__outlinerApp = outliner;          // for the test

/* ---- header: which file, where */
const label = abs => abs?.startsWith('gc:') ? { name: abs.split('/').pop(), where: 'godcaster' }
  : abs?.startsWith('pub:') ? { name: abs.slice(4), where: 'adam.curry.com' }
  : { name: decodeURIComponent((abs || '').split('/').pop().split('%2F').pop()), where: 'this phone' };
let openName = null;
function showName() {
  const p = outliner.path();
  if (!p) { $('#fname').textContent = 'OPML Outliner'; $('#where').textContent = ''; return; }
  $('#fname').textContent = openName || label(p).name; $('#where').textContent = label(p).where;
}
window.addEventListener('sc:outline-state', showName);
async function open(abs, name) {
  openName = name || null;
  if (await openOutline({ abs }, name || abs)) { $('#oalert')?.remove(); showName(); closeFiles(); return true; }
  // unsaved edits that could not be saved (e.g. changed on disk meanwhile): never dropped silently
  if (outliner.dirty()) { closeFiles(); say('This outline has changes that are not saved yet. Choose in the yellow bar first, then open the other file.', true); }
  return false;
}
window.__openPath = (abs, name) => open(abs, name);

/* ---- the Files screen: godcaster's recent outlines + this phone's */
function frow(o, onOpen, onForget) {
  const r = document.createElement('div'); r.className = 'frow' + (o.abs === outliner.path() ? ' cur' : '');
  const fn = document.createElement('div'); fn.className = 'fn';
  const b = document.createElement('b'); b.textContent = o.name; const sm = document.createElement('small'); sm.textContent = o.sub || '';
  fn.append(b, sm); r.append(fn); r.onclick = onOpen;
  if (onForget) { const x = document.createElement('button'); x.textContent = '✕'; x.title = 'Remove from this list';
    x.onclick = e => { e.stopPropagation(); onForget(); }; r.append(x); }
  return r;
}
const ago = ms => { if (!ms) return ''; const m = Math.round((Date.now() - ms) / 60000);
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
async function loadFiles() {
  const gc = $('#gclist'); gc.innerHTML = '<div class="msg">Loading…</div>';
  const r = await call('remoteRecent');
  gc.innerHTML = '';
  if (!r || r.error) gc.innerHTML = `<div class="msg">Godcaster is not reachable (${(r && r.error) || 'no answer'}). Is Tailscale on, and godcaster awake?</div>`;
  else if (!r.files.length) gc.innerHTML = '<div class="msg">No recent files on godcaster yet.</div>';
  else for (const f of r.files) {
    const abs = 'gc:' + f.path;
    gc.append(frow({ abs, name: f.name, sub: `${f.dir} · changed ${ago(f.mtimeMs)}` }, () => f.exists && open(abs, f.name)));
  }
  const loc = await call('localRecent'), ll = $('#locallist'); ll.innerHTML = '';
  if (!loc.files.length) ll.innerHTML = '<div class="msg">No phone files opened yet.</div>';
  for (const f of loc.files) ll.append(frow({ abs: f.abs, name: f.name, sub: `opened ${ago(f.t)}` }, () => open(f.abs, f.name),
                                             async () => { await call('forgetLocal', { abs: f.abs }); loadFiles(); }));
}
function openFiles() { $('#files').hidden = false; loadFiles(); }
function closeFiles() { if (outliner.hasDoc()) $('#files').hidden = true; }
$('#bfiles').onclick = openFiles;
$('#fclose').onclick = closeFiles;
$('#frefresh').onclick = loadFiles;
$('#fopen').onclick = async () => { const f = await call('choose'); if (f && !f.error) open(f.abs, f.name); else if (f?.error) say(f.error, true); };
$('#fnew').onclick = async () => { const f = await call('create'); if (f && !f.error) open(f.abs, f.name); else if (f?.error) say(f.error, true); };
$('#fserver').onclick = async () => {
  const cur = (await call('getServer')).server;
  const v = await askText({ title: 'Godcaster address', note: 'outliner-sync on godcaster, over Tailscale.', value: cur });
  if (v) { await call('setServer', { server: v }); loadFiles(); }
};

/* ---- publishing to adam.curry.com (cartpub on helix; the screens are the desktop's, outliner-publish.js) */
// FNV-1a of the outline without the editor's bookkeeping: "does my copy have edits that were never published?"
const pubHash = x => { let h = 0x811c9dc5; const t = sameOutline(x); for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };
const api = {
  cartGet: path => call('cartGet', { path }),
  cartPost: (path, body) => call('cartPost', { path, body }),
  cartUpload: () => call('cartUpload'),
  openExternal: url => call('openUrl', { url }),
  // adam.curry.com answers https now; the phone allows plain http only on the tailnet
  fetchUrl: url => call('fetchUrl', { url: url.replace(/^http:\/\/adam\.curry\.com\//i, 'https://adam.curry.com/') }),
  // Open a Published Page: no file dialog; the copy is the app's own (pub:<cart file>). Same rules as the desktop.
  async savePublished(name, xml) {
    const r = await call('pubRead', { name });
    if (r.error) return say(r.error, true);
    const mine = r.xml;
    if (mine != null && sameOutline(mine) === sameOutline(xml)) { /* unchanged both sides: open my copy as saved */ }
    else if (mine != null && r.hash !== pubHash(mine)) {
      const keep = await askText({ title: 'Your copy of this page has changes that are not on adam.curry.com.', confirm: true,
        ok: 'Open my copy', cancel: 'Load the published version', note: 'Loading the published version replaces your changes (a backup is kept).' });
      if (keep === null) { const w = await call('pubWrite', { name, xml }); if (w.error) return say(w.error, true); }
    } else { const w = await call('pubWrite', { name, xml }); if (w.error) return say(w.error, true); }
    const now = await call('pubRead', { name });
    if (now.xml != null && sameOutline(now.xml) === sameOutline(xml)) await call('pubMark', { name, hash: pubHash(now.xml) });
    await open('pub:' + name);
    return { abs: 'pub:' + name };
  },
  async markPublished(path) {
    if (!path?.startsWith('pub:')) return;
    const r = await call('pubRead', { name: path.slice(4) });
    if (r.xml != null) await call('pubMark', { name: path.slice(4), hash: pubHash(r.xml) });
  },
};
const P = initPublishing({ outliner, askText, say, report: showName, api });
window.__publishing = P;    // for the test
$('#tpublish').onclick = () => P.publish();
$('#ttype').onclick = () => P.chooseLineType();
$('#tattach').onclick = () => P.attach();
// Picture (2026-11-18): from the phone's photos, made web-sized on the phone, uploaded, inserted after the selected line
$('#tpicture').onclick = async () => {
  if (!outliner.hasDoc()) return say('open an outline first', true);
  const r = await call('pickPicture');
  if (!r) return;
  if (r.error) return say(`picture: ${r.error}`, true);
  outliner.insertMedia(r);
  showName();
  say(`picture added (${r.width}×${r.height}, ${Math.round(r.length / 1024)} KB)`);
};
$('#tinclude').onclick = () => P.include();
$('#fpublished').onclick = () => P.openPublished();

/* ---- Markdown: save to the phone, or publish to adam.curry.com/md/ (calendar layout BonBon and MD Web read) */
const mdKey = () => 'mdpost:' + (outliner.path() || '');
const mdFrontMatter = (title, md) => `---\ntitle: ${JSON.stringify(title)}\nauthor: "Adam Curry"\n---\n\n# ${title}\n\n${md}`;
async function markdownDialog() {
  if (!outliner.hasDoc()) return say('open an outline first', true);
  let conv;
  try { conv = opmlToMarkdown(outliner.publishXml()); } catch (e) { return say('markdown: ' + e.message, true); }
  const p = outliner.path() || '';
  const title0 = outliner.docTitle() || conv.title || p.split('/').pop().replace(/\.opml$/i, '');
  const pinned = (await call('prefGet', { key: mdKey() })).value || '';
  $('#md-title').value = title0;
  $('#md-preview').textContent = conv.markdown;
  $('#md-newrow').hidden = !pinned; $('#md-new').checked = false;
  const note = () => {
    const upd = pinned && !$('#md-new').checked;
    $('#md-note').textContent = upd ? `Publish UPDATES the post at:\nhttps://adam.curry.com/md/${pinned}.md`
      : 'Publish makes a NEW post on today\'s page at adam.curry.com/md/ (it shows in the calendar).';
  };
  $('#md-new').onchange = note; note();
  $('#md-result').hidden = true; $('#md-pub').disabled = false; $('#md-save').disabled = false;
  const dlg = $('#mddlg'); dlg.returnValue = ''; dlg.showModal();
  $('#md-save').onclick = async () => {
    const title = $('#md-title').value.trim() || title0;
    const name = title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) + '.md';
    const r = await call('createText', { name, mime: 'text/markdown', text: mdFrontMatter(title, conv.markdown) });
    if (r?.error) $('#md-note').textContent = 'Not saved: ' + r.error;
    else if (r) $('#md-note').textContent = `Saved to the phone as ${r.name}.`;
  };
  $('#md-pub').onclick = async () => {
    const title = $('#md-title').value.trim();
    if (!title) { $('#md-note').textContent = 'A title is needed.'; return; }
    $('#md-pub').disabled = true; $('#md-note').textContent = 'Publishing…';
    const id = pinned && !$('#md-new').checked ? pinned : '';
    const r = await api.cartPost('/api/publish-md', { title, markdown: conv.markdown, id });
    $('#md-pub').disabled = false;
    if (!r || r.error) { $('#md-note').textContent = 'Not published: ' + ((r && r.error) || 'no answer from helix (is Tailscale on?)'); return; }
    if (outliner.path()) await call('prefSet', { key: mdKey(), value: r.id });
    $('#md-note').textContent = `Published (${r.changed} files changed, ${r.cache}).`;
    const res = $('#md-result'); res.innerHTML = ''; res.hidden = false;
    for (const [label, url] of [['The post', r.url], ['Today\'s page', r.day_url], ['The site', r.home]]) {
      const a = document.createElement('a'); a.href = '#'; a.textContent = `${label}: ${url}`;
      a.onclick = e => { e.preventDefault(); api.openExternal(url); };
      const d = document.createElement('div'); d.append(a); res.append(d);
    }
  };
}
$('#tmd').onclick = markdownDialog;
window.__markdown = { opmlToMarkdown, markdownDialog };   // for the test

/* ---- touch toolbar: the keys a phone does not have */
const keep = fn => () => { fn(); $('#otree').focus(); };
$('#tedit').onclick = () => outliner.edit();
$('#tnew').onclick = keep(() => { outliner.newLine(); });
$('#tin').onclick = keep(() => outliner.indent());
$('#tout').onclick = keep(() => outliner.outdent());
$('#tup').onclick = keep(() => outliner.moveUp());
$('#tdown').onclick = keep(() => outliner.moveDown());
$('#tundo').onclick = keep(() => outliner.undo());
$('#tredo').onclick = keep(() => outliner.redo());
$('#tdel').onclick = async () => { if (outliner.hasSelection() && await askText({ title: 'Delete this line and everything under it?', ok: 'Delete', confirm: true }) !== null) outliner.remove(); };
$('#oexpand').onclick = () => outliner.expandAll();
$('#ocollapse').onclick = () => outliner.collapseAll();
// long-press a line = edit it (tap selects, double-tap opens/closes, as on the desktop)
$('#otree').addEventListener('contextmenu', e => {
  const l = e.target.closest('.oline'); if (!l) return;
  e.preventDefault(); l.click(); setTimeout(() => outliner.edit(), 30);
});

/* ---- Android hooks: back button, leaving the app */
window.__back = () => {
  for (const d of ['#askdlg', '#pubdlg', '#pickdlg', '#mddlg']) if ($(d).open) { $(d).close(); return true; }
  if (!$('#files').hidden && outliner.hasDoc()) { closeFiles(); return true; }
  if (outliner.editing()) { const i = $('#otree .oedit'); i?.blur(); return true; }
  return false;
};
window.__saveNow = () => { if (outliner.dirty()) outliner.save(); };

/* ---- start: the last file, or the Files screen */
(async () => {
  const last = (await call('lastFile')).abs;
  if (!(last && await open(last))) openFiles();
})();
