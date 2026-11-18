/**
 * The show outline — EDITABLE (2.1.4).
 *
 * Adam, 2026-10-05: "I'm still unsure whether I like the whole idea of a non-editable OPML editor
 * and the clicks relating to the files. I think I want to separate those, and I think I want to
 * make the OPML editor actually editable."
 *
 * So: clicking selects a line and does NOTHING else (the outline no longer drives the clip
 * browser), and every line can be edited, with the keys of Adam's own OPML outliner
 * (~/Work/opml-outliner): Enter = new line below, Tab / Shift+Tab = indent / outdent,
 * Ctrl+U / Ctrl+D (or Ctrl+↑ / Ctrl+↓) = move, F2 or Esc = edit, Delete = remove, ←/→ = fold,
 * Ctrl+C / X / V = copy / cut / paste a line with everything under it, Ctrl+Z / Ctrl+Y = undo /
 * redo, Ctrl+B / Ctrl+I while typing = bold / italic, Ctrl+Enter = open the line's link or fold it,
 * Ctrl+S = save. 2.3.7: Ctrl+Shift+V = Paste as Nodes, Ctrl+L = add / change / remove a line's link.
 *
 * THE FILE IS EDITED AS A DOCUMENT, not rebuilt from a summary: every attribute and every node
 * StudioCast does not show (Sam's producer notes, a separator line, a field this app has never
 * heard of) is written back exactly as it was. Saving goes through main/opml.js, which refuses to
 * write over a version Sam shipped after this one was opened, and keeps a backup of every save.
 */
const $ = s => document.querySelector(s);
const el = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt !== undefined) e.textContent = txt; return e; };

let doc = null, rel = null, mtimeMs = null, xmlDecl = '';
let flat = [], cur = null, editing = false, dirty = false;
let undoStack = [], redoStack = [], clip = null;
let collapsed = new WeakSet();
let say = console.log;
let askText = null;
// The standalone OPML Outliner app (outliner/) runs this same editor. There it shows EVERY line, and keeps
// the open/closed state + selection in the file the way Adam's old opml-outliner.py did (_expanded="true",
// <head><state selectedPath scrollY>), so both read each other's files. CurryCaster II never does either.
let STANDALONE = false;

const ALLOWED = /&lt;(\/?)(b|i|strong|em|u)&gt;/gi;
const richText = s => (s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))
  .replace(ALLOWED, '<$1$2>').replace(/&lt;br\s*\/?&gt;/gi, '<br>');
const isRuleText = t => { const c = (t || '').replace(/\s+/g, ''); return c.length >= 6 && /^[-–—_=]+$/.test(c); };
// Producer notes never reach the screen (they are still in the file, untouched).
const hidden = elm => !STANDALONE && elm.parentElement?.tagName === 'body'
  && /^(producer\s*notes|notes\s*to\s*self)\b/i.test((elm.getAttribute('text') || '').replace(/^[^\w]+/, '').trim());
const kids = elm => [...elm.children].filter(c => c.tagName === 'outline');
const body = () => doc?.querySelector('body');
const rawOf = elm => elm.getAttribute('text') || '';
/*
 * WHAT A LINE SAYS, the way Adam's own outliner reads it (opml-outliner.py load_opml: the XML
 * parser decodes once, then html.unescape once more). Some outlines store bold as
 * text="&amp;lt;b&amp;gt;…", which after one decode is still "&lt;b&gt;" — and StudioCast showed
 * that literally (Adam, 2026-10-05: "&lt;b&gt;Marketing Death&lt;/b&gt;"). A <textarea>'s innerHTML
 * decodes entities as plain text and never runs markup, so this is safe. A line is only ever
 * WRITTEN back when it is edited; untouched lines keep their exact original form in the file.
 */
const _dec = document.createElement('textarea');
const decode = s => { if (!/&[#a-z0-9]+;/i.test(s)) return s; _dec.innerHTML = s; return _dec.value; };
const textOf = elm => {
  // An <a href> inside the text shows as its words (the link is offered as ↗), as in Adam's outliner.
  return decode(rawOf(elm)).replace(/<a\s[^>]*href="[^"]*"[^>]*>([^<]*)<\/a>/gi, '$1');
};
const linkOf = elm => elm.getAttribute('url') || elm.getAttribute('xmlUrl') || elm.getAttribute('htmlUrl')
  || (decode(rawOf(elm)).match(/<a\s[^>]*href="([^"]+)"/i) || [])[1] || '';

/* ---- inline bold / italics / links (standalone, Adam 11-11: "a single word instead of the whole block") ----
 * The line's text is stored as cart stores it: plain words with <b>, <i>, <u> and <a href="…">…</a> inside. */
let askingLink = false;
const safeHref = u => /^(https?:|mailto:|ftp:)/i.test(u || '') ? u.replace(/"/g, '%22') : '';
/** Stored text -> what the rich edit box (and the line itself) shows. Only these tags ever become markup. */
const inlineHtml = s => richText(s).replace(/&lt;a\s[^&]*?href="([^"]*)"[^&]*?&gt;/gi,
  (m, h) => { const u = safeHref(h.replace(/&amp;/g, '&')); return u ? `<a href="${u.replace(/&/g, '&amp;')}">` : ''; })
  .replace(/&lt;\/a&gt;/gi, '</a>');
/** The rich edit box -> stored text. Anything a browser adds (spans, divs, &nbsp;) is dropped; words are kept. */
function editValue(inp) {
  if (!inp.isContentEditable) return inp.value;
  const walk = n => [...n.childNodes].map(c => {
    if (c.nodeType === 3) return c.data.replace(/\u00a0/g, ' ').replace(/[\r\n]+/g, ' ').replace(/</g, '&lt;');
    if (c.nodeType !== 1) return '';
    const t = c.tagName, inner = walk(c);
    if (t === 'BR') return ' ';
    if (!inner) return '';
    if (t === 'B' || t === 'STRONG') return `<b>${inner}</b>`;
    if (t === 'I' || t === 'EM') return `<i>${inner}</i>`;
    if (t === 'U') return `<u>${inner}</u>`;
    if (t === 'A') { const u = safeHref(c.getAttribute('href')); return u ? `<a href="${u}">${inner}</a>` : inner; }
    return inner;
  }).join('');
  return walk(inp).replace(/<\/(b|i|u)><\1>/g, '').replace(/ {2,}/g, ' ').trim();
}
/** Ctrl+L / Link… while editing with words selected: link (or unlink) just those words. */
async function linkSelection(inp) {
  const sel = getSelection();
  if (!sel.rangeCount || sel.isCollapsed || !inp.contains(sel.anchorNode)) return false;
  const range = sel.getRangeAt(0).cloneRange(), words = sel.toString().trim();
  const inA = n => { for (; n && n !== inp; n = n.parentNode) if (n.tagName === 'A') return n; return null; };
  const was = inA(range.startContainer)?.getAttribute('href') || '';
  askingLink = true;
  let u;
  try {
    u = askText ? await askText({ title: was ? 'Change link' : 'Link these words', value: was, ok: 'OK',
      note: `On "${words.slice(0, 60)}". Leave it empty to remove the link.` }) : null;
  } finally { askingLink = false; }
  if (!inp.isConnected) return true;
  inp.focus(); sel.removeAllRanges(); sel.addRange(range);
  if (u == null) return true;
  u = u.trim();
  if (u && !safeHref(u)) u = 'https://' + u.replace(/^\/+/, '');
  document.execCommand('unlink');
  if (u) document.execCommand('createLink', false, u);
  sel.collapseToEnd();
  return true;
}

/* ---- SPELLING on the lines (standalone, Adam 11-11: "the squiggly red line would stay until the word is properly
 * spelled ... a right mouse click would bring up suggestions"). Chromium marks words only while you type in the
 * edit box; the lines are plain text, so the app marks them itself (window.outlinerApp.spell, from the preload). */
const SPELL_WORD = /[A-Za-z\u00c0-\u024f]+(?:['\u2019][A-Za-z\u00c0-\u024f]+)*/g;
const SPELL_SKIP = /\b(?:https?|ftp):\/\/\S+|\bwww\.\S+|\S+@\S+\.\w+|\S+\.(?:com|org|net|fm|io|opml|xml|html?|mp3|m4a|wav|jpg|png)\b\S*/gi;
const spellRaw = () => window.outlinerApp?.spell || window.studiocast?.spell || null;   // both apps (CurryCaster 11-11)
// Spelling on/off switch at the top (Adam 11-13: "a button at the top to turn spelling on or off, since there's a lot of
// squiggly lines"). Off = no marks on the lines, none in the edit box, no spelling menu. Kept on this computer.
let spellOn = true; try { spellOn = localStorage.getItem('sc.outlineSpell') !== '0'; } catch {}
const spellApi = () => spellOn ? spellRaw() : null;
let spellCache = new Map(), spellObs = null;
const spellAdded = new Set();          // words added to the dictionary (lower case): never marked, at once
let spellWordsLoaded = false;
function loadSpellWords() {
  if (spellWordsLoaded || !spellRaw()?.words) return; spellWordsLoaded = true;
  spellRaw().words().then(ws => { let n = 0; for (const w of ws || []) { spellAdded.add(String(w).toLowerCase()); n++; } if (n) respell(); }).catch(() => {});
}
function isBad(w) {
  if (w.length < 2 || /^[A-Z0-9]+$/.test(w)) return false;          // acronyms and single letters are left alone
  if (spellAdded.has(w.toLowerCase())) return false;                 // added to the dictionary
  if (!spellCache.has(w)) { try { spellCache.set(w, !!spellApi().misspelled(w)); } catch { spellCache.set(w, false); } }
  return spellCache.get(w);
}
function markSpelling(tx) {
  if (!spellApi() || tx.dataset.spelled) return;
  tx.dataset.spelled = '1';
  const counts = new Map();
  const walker = document.createTreeWalker(tx, NodeFilter.SHOW_TEXT);
  const nodes = []; let n; while ((n = walker.nextNode())) nodes.push(n);
  for (const t of nodes) {
    const parts = []; let last = 0, m;
    const urls = [...t.data.matchAll(SPELL_SKIP)].map(u => [u.index, u.index + u[0].length]);   // web addresses, file names
    SPELL_WORD.lastIndex = 0;
    while ((m = SPELL_WORD.exec(t.data))) {
      const w = m[0], k = counts.get(w) || 0; counts.set(w, k + 1);
      if (urls.some(([a, b]) => m.index >= a && m.index < b) || !isBad(w)) continue;
      parts.push(document.createTextNode(t.data.slice(last, m.index)));
      const sp = document.createElement('span'); sp.className = 'ospell'; sp.textContent = w; sp.dataset.k = k;
      parts.push(sp); last = m.index + w.length;
    }
    if (!parts.length) continue;
    parts.push(document.createTextNode(t.data.slice(last)));
    t.replaceWith(...parts);
  }
}
/** Mark the lines as they scroll into view (a big outline is never checked all at once). */
function watchSpelling(host) {
  if (!spellApi()) return;
  spellObs?.disconnect();
  spellObs = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { markSpelling(e.target); spellObs.unobserve(e.target); } },
                                      { root: host, rootMargin: '200px' });
  for (const tx of host.querySelectorAll('.oline .otx')) spellObs.observe(tx);
}
/** The k-th "word" in the line's words (tags skipped) becomes "repl". */
function replaceWordIn(n, word, k, repl) {
  const raw = decode(rawOf(n)); let seen = 0, done = false;
  const out = raw.replace(/(<[^>]*>)|([^<]+)/g, (all, tag, text) => tag || text.replace(SPELL_WORD, w => {
    if (done || w !== word) return w; if (seen++ === k) { done = true; return repl; } return w; }));
  if (!done) return false;
  snapshot(); n.setAttribute('text', out); return true;
}
async function spellMenu(ev, item) {
  const sp = ev.target.closest?.('.ospell'), api = spellApi();
  if (!sp || !api) return;
  ev.preventDefault(); ev.stopPropagation();
  const w = sp.textContent, k = +sp.dataset.k;
  let sugg = []; try { sugg = api.suggest(w) || []; } catch {}
  const r = await api.menu(w, sugg);
  if (r?.replace) { if (replaceWordIn(item.n, w, k, r.replace)) { render(); say(`spelling: ${w} → ${r.replace}`); } }
  else if (r?.add) { spellAdded.add(w.toLowerCase()); await api.add(w); respell(); say(`spelling: "${w}" added to the dictionary`); }
}
/* In the EDIT BOX (Adam 11-11: "when you go into edit mode, the squiggly line disappears"): Chromium marks only the
 * words you type, so the box marks every word itself, with a CSS highlight (no extra markup in what you edit). */
function wordRanges(root) {
  const out = [], walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let t;
  while ((t = walker.nextNode())) {
    const urls = [...t.data.matchAll(SPELL_SKIP)].map(u => [u.index, u.index + u[0].length]);
    for (const m of t.data.matchAll(SPELL_WORD)) {
      if (urls.some(([a, b]) => m.index >= a && m.index < b) || !isBad(m[0])) continue;
      const r = new Range(); r.setStart(t, m.index); r.setEnd(t, m.index + m[0].length); out.push(r);
    }
  }
  return out;
}
function markEditBox(inp) {
  if (!spellApi() || !window.CSS?.highlights || !inp.isConnected) return;
  CSS.highlights.set('ospell', new Highlight(...wordRanges(inp)));
}
async function editSpellMenu(ev, inp) {
  const api = spellApi(); if (!api) return;
  const pos = document.caretRangeFromPoint?.(ev.clientX, ev.clientY);
  const t = pos?.startContainer; if (!t || t.nodeType !== 3 || !inp.contains(t)) return;
  const hit = [...t.data.matchAll(SPELL_WORD)].find(m => pos.startOffset >= m.index && pos.startOffset <= m.index + m[0].length);
  if (!hit || !isBad(hit[0])) return;                     // not a marked word: the normal Cut / Copy / Paste menu
  ev.preventDefault(); ev.stopPropagation();
  const w = hit[0], r = new Range(); r.setStart(t, hit.index); r.setEnd(t, hit.index + w.length);
  let sugg = []; try { sugg = api.suggest(w) || []; } catch {}
  askingLink = true;                                       // the menu takes the focus: do not finish the edit
  let c; try { c = await api.menu(w, sugg); } finally { askingLink = false; }
  if (!inp.isConnected) return;
  inp.focus(); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  if (c?.replace) document.execCommand('insertText', false, c.replace);
  else if (c?.add) { spellAdded.add(w.toLowerCase()); await api.add(w); spellCache = new Map(); sel.collapseToEnd(); }
  else sel.collapseToEnd();
  markEditBox(inp);
}

/** Check again (after "Add to the dictionary", or once the dictionary has loaded). */
export function respell() { spellCache = new Map(); if (doc) render(); }

export function initOutliner({ log, ask, standalone = false }) {
  STANDALONE = !!standalone;
  // the spell checker's dictionary loads a moment after start: check the lines again then
  loadSpellWords();
  if (spellApi()) for (const ms of [2500, 8000]) setTimeout(() => { if (!editing) respell(); }, ms);
  say = log || say;
  askText = ask || askText;
  const host = $('#otree');
  host.onkeydown = onKey;
  new ResizeObserver(() => { const t = host.querySelector('.otail'); if (t) t.style.height = tailHeight(host) + 'px'; }).observe(host);
  $('#osave').onclick = () => save();
  // Any outline on the machine, not only the show's prep file (Adam, 2026-10-05). NEW (2.3.1) makes
  // one for somebody who has none, then opens it exactly like Open… does.
  const adopt = async f => {
    if (await openOutline({ abs: f.abs }, f.abs)) {
      const sel = $('#oshow');
      if (!sel) { window.dispatchEvent(new Event('sc:outline-picked')); return; }
      let o = [...sel.options].find(x => x.value === 'abs:' + f.abs);
      if (!o) { o = document.createElement('option'); o.value = 'abs:' + f.abs; o.textContent = `📄 ${f.name}`; sel.prepend(o); }
      sel.value = o.value;
      say(`outline: opened ${f.abs}`);
      window.dispatchEvent(new Event('sc:outline-picked'));     // the show remembers it (on Save)
    }
  };
  $('#oopen').onclick = async () => { const f = await window.studiocast.opml.choose(); if (f) adopt(f); };
  $('#onew').onclick = async () => {
    const f = await window.studiocast.opml.create();
    if (!f) return;
    if (f.error) return say(`new outline: ${f.error}`, true);
    await adopt(f);
    say(`outline: made ${f.abs} — click the line and press Esc to type`);
  };
  $('#oexpand').onclick = () => { if (!doc) return; collapsed = new WeakSet(); render(); };
  $('#ocollapse').onclick = () => { if (!doc) return; defaultFold(); render(); };
  $('#opaste-nodes').onclick = () => pasteAsNodes();
  $('#olink').onmousedown = ev => { if (editing && $('#otree .oedit.rich')) ev.preventDefault(); };   // keep the selected words
  $('#olink').onclick = async () => { const inp = $('#otree .oedit.rich');
    if (editing && inp && await linkSelection(inp)) return;
    if (editing && inp) commitEdit(editValue(inp), false);
    editLink(); };
  // Spelling on/off (Adam 11-13). The button shows the state now.
  const spellBtn = $('#ospell');
  if (spellBtn) {
    const show = () => { spellBtn.textContent = spellOn ? 'Spelling: On' : 'Spelling: Off'; spellBtn.classList.toggle('off', !spellOn); };
    show();
    spellBtn.onclick = () => {
      spellOn = !spellOn; try { localStorage.setItem('sc.outlineSpell', spellOn ? '1' : '0'); } catch {}
      show(); if (!spellOn) { try { CSS.highlights?.delete('ospell'); } catch {} }
      respell(); say(spellOn ? 'spelling: on' : 'spelling: off');
    };
  }
  // 2.4.14: dark or light, a switch in the editor itself (Adam). The button names what it switches TO.
  const darkBtn = $('#odark');
  if (darkBtn) {
    const pane = $('#outlinepane');
    const set = on => { pane.classList.toggle('dark', on); darkBtn.textContent = on ? 'Light' : 'Dark';
                        try { localStorage.setItem('sc.outlineDark', on ? '1' : '0'); } catch {} };
    let was = false; try { was = localStorage.getItem('sc.outlineDark') === '1'; } catch {}
    set(was);
    darkBtn.onclick = () => set(!pane.classList.contains('dark'));
  }
}

/** Open a show's outline (path relative to the clip library). Unsaved edits are saved first. */
export async function openOutline(relPath, label) {
  if (dirty && !(await save())) return false;
  conflictBar(null);
  if (!relPath) { doc = null; rel = null; $('#otree').innerHTML = '<div class="onone">No outline for this show.</div>'; paintState(); return true; }
  const r = await window.studiocast.opml.read(relPath);
  if (r.error) { $('#otree').innerHTML = `<div class="onone">Outline failed: ${r.error}</div>`; return false; }
  if (!load(r.xml)) return false;
  rel = relPath; mtimeMs = r.mtimeMs; dirty = false; undoStack = []; redoStack = [];
  $('#opath').textContent = `…${label || (typeof relPath === 'string' ? relPath : relPath.abs)}`;
  cur = null;
  // The standalone opens a file EXACTLY as it was saved (Adam, 10-21: "obviously"): open lines from _expanded, else
  // from expansionState (a page from cart / adam.curry.com, or a save with every line shut), then the selection.
  if (STANDALONE) {
    if (!fileFold() && !esFold()) defaultFold();
    cur = byIndexPath(doc.querySelector('head > state')?.getAttribute('selectedPath'));
  } else defaultFold();
  render();
  if (STANDALONE) { const y = +doc.querySelector('head > state')?.getAttribute('scrollY'); if (y > 0 && !cur) $('#otree').scrollTop = y; }
  window.dispatchEvent(new Event('sc:outline-state'));
  return true;
}

function load(xml) {
  const d = new DOMParser().parseFromString(xml, 'text/xml');
  if (d.querySelector('parsererror') || !d.querySelector('body')) {
    $('#otree').innerHTML = '<div class="onone">Outline failed: this OPML is not valid XML</div>'; return false;
  }
  doc = d;
  xmlDecl = (xml.match(/^\s*<\?xml[^>]*\?>\s*/) || [''])[0].trim();
  return true;
}
const serialize = () => (xmlDecl ? xmlDecl + '\n' : '') + new XMLSerializer().serializeToString(doc).replace(/^<\?xml[^>]*\?>\s*/, '');

/* ---- the standalone app's per-file state (same format as opml-outliner.py) ---- */
// Open/shut from _expanded="true". Returns false when the file carries no such state (then defaultFold).
function fileFold() {
  const all = [...body().querySelectorAll('outline')];
  if (!all.some(n => n.hasAttribute('_expanded'))) return false;
  collapsed = new WeakSet();
  for (const n of all) if (kids(n).length && n.getAttribute('_expanded') !== 'true') collapsed.add(n);
  return true;
}
// "0/2/1": 0-based index among the outline children, from the body down (opml-outliner.py's selectedPath).
function indexPath(n) {
  const parts = [];
  for (let x = n; x && x.tagName === 'outline'; x = x.parentElement) parts.unshift(kids(x.parentElement).indexOf(x));
  return parts.join('/');
}
function byIndexPath(p) {
  if (!p || !/^\d+(\/\d+)*$/.test(p)) return null;
  let x = body();
  for (const i of p.split('/').map(Number)) { x = kids(x)[i]; if (!x) return null; }
  // only if every parent is open, so the selection can be seen
  for (let y = x.parentElement; y && y.tagName === 'outline'; y = y.parentElement) if (collapsed.has(y)) return null;
  return x;
}
// Written just before a save: which lines are open, which is selected, where the view is scrolled.
function writeFileState() {
  for (const n of body().querySelectorAll('outline')) {
    if (kids(n).length && !collapsed.has(n)) n.setAttribute('_expanded', 'true'); else n.removeAttribute('_expanded');
  }
  let head = doc.querySelector('opml > head');
  if (!head) { head = doc.createElement('head'); doc.documentElement.prepend(head); }
  let st = head.querySelector(':scope > state');
  if (!st) { st = doc.createElement('state'); head.append(st); }
  if (cur) st.setAttribute('selectedPath', indexPath(cur)); else st.removeAttribute('selectedPath');
  // the open lines also as expansionState (cart's reading), so a save with every line shut reopens shut
  let es = head.querySelector(':scope > expansionState');
  if (!es) { es = doc.createElement('expansionState'); head.append(es); }
  es.textContent = expansionState();
  st.setAttribute('scrollY', String(Math.round($('#otree').scrollTop)));
}

/** For the standalone app's menus. */
export const outliner = {
  hasDoc: () => !!doc,
  dirty: () => dirty,
  path: () => (rel && typeof rel === 'object' ? rel.abs : rel),
  expandAll() { if (!doc) return; collapsed = new WeakSet(); render(); },
  collapseAll() { if (!doc) return; collapsed = new WeakSet(); body().querySelectorAll('outline').forEach(n => { if (kids(n).length) collapsed.add(n); }); render(); },
  respell: () => respell(),
  undo: () => undo(), redo: () => redo(), pasteAsNodes: () => pasteAsNodes(), editLink: () => editLink(),
  // touch buttons (the Android app has no Esc / Tab / Ctrl keys)
  edit: () => startEdit(), newLine: () => { if (doc) newLine(); }, indent: () => indent(), outdent: () => outdent(),
  moveUp: () => move(-1), moveDown: () => move(1), remove: () => remove(),
  hasSelection: () => !!cur, editing: () => editing,
  save: () => save(),
  /** Save under a new name the main process has already allowed (chosen in a dialog). */
  async saveAs(abs, label) { if (!doc) return false; rel = { abs }; mtimeMs = null; $('#opath').textContent = `…${label || abs}`; return save(true); },
  /** Import from URL: the fetched outline's lines go in as one new line (its title) after the selected one. */
  importOpml(xml, title) {
    const d = new DOMParser().parseFromString(xml, 'text/xml');
    const b = d.querySelector('body');
    if (d.querySelector('parsererror') || !b) return 'that address did not return a valid OPML outline';
    if (!doc) return 'open or start an outline first';
    snapshot();
    const top = doc.createElement('outline'); top.setAttribute('text', title);
    for (const o of [...b.children].filter(c => c.tagName === 'outline')) top.append(doc.importNode(o, true));
    if (cur) cur.after(top); else body().append(top);
    cur = top; collapsed.delete(top); dirty = true; render(); return null;
  },
  // ---- cart.curry.com's editor features, for publishing through cartpub on helix (standalone app only)
  nodeType: () => (cur ? (cur.getAttribute('type') || '') : null),
  urlInText: () => (cur ? urlInText(cur) : ''),
  hasUrl: () => !!cur?.getAttribute('url'),
  setType: (t, url) => setType(t, url),
  insertMedia: m => insertMedia(m),
  setInclude: (url, xml) => setInclude(url, xml),
  docTitle: () => (doc?.querySelector('opml > head > title')?.textContent || '').trim(),
  publishState: () => { const p = doc?.querySelector('opml > head > publish'); return p ? { file: p.getAttribute('file') || '', redirect: p.getAttribute('redirect') || '' } : {}; },
  /** Before a publish: remember where it goes and write expansionState from the open lines (cart renders them open). */
  preparePublish({ file, redirect }) {
    if (!doc) return;
    const head = headEl();
    let p = head.querySelector(':scope > publish');
    if (!p) { p = doc.createElement('publish'); head.append(p); }
    if (file) p.setAttribute('file', file); else p.removeAttribute('file');
    if (redirect) p.setAttribute('redirect', redirect); else p.removeAttribute('redirect');
    let es = head.querySelector(':scope > expansionState');
    if (!es) { es = doc.createElement('expansionState'); head.append(es); }
    es.textContent = expansionState();
    dirty = true; paintState();
  },
  /** What goes to adam.curry.com: the outline WITHOUT this editor's bookkeeping (_expanded, <state>); the page's
   *  open sections are in expansionState. (Left in, _expanded would win over expansionState at the next open.) */
  publishXml() {
    if (!doc) return null;
    const keep = doc;
    doc = doc.cloneNode(true);
    doc.querySelectorAll('outline[_expanded]').forEach(n => n.removeAttribute('_expanded'));
    doc.querySelector('opml > head > state')?.remove();
    const x = serialize();
    doc = keep;
    return x;
  },
  /** Export HTML: numbered outline, bold/italic kept, links clickable (as opml-outliner.py exported). */
  exportHtml(title) {
    if (!doc) return null;
    const esc = t => (t || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const walk = (nodes, prefix) => nodes.map((n, i) => {
      const num = prefix + (i + 1), u = linkOf(n), t = richText(textOf(n));
      const line = `<div class="n" style="margin-left:${(prefix.split('.').length - 1) * 1.6}em"><span class="num">${num}.</span> ${u ? `<a href="${esc(u)}">${t}</a>` : t}</div>`;
      return line + walk(kids(n), num + '.');
    }).join('\n');
    return `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><style>body{font:15px/1.5 system-ui,sans-serif;max-width:900px;margin:2em auto;padding:0 1em}.num{color:#888;margin-right:.3em}a{color:#2a5db0}</style>\n<h1>${esc(title)}</h1>\n${walk(kids(body()), '')}\n`;
  },
};

// Opening shape: the ShowNotes node open, everything under it shut, other top nodes shut.
function defaultFold() {
  collapsed = new WeakSet();
  for (const top of kids(body())) {
    if (kids(top).length && !/shownotes/i.test(textOf(top))) collapsed.add(top);
    top.querySelectorAll('outline').forEach(n => { if (kids(n).length) collapsed.add(n); });
  }
}

/* ---------------------------------------------------------------- drawing */
function flatten() {
  flat = [];
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      if (hidden(n)) continue;
      const k = kids(n).length > 0;
      flat.push({ n, depth, hasKids: k, isRule: !k && isRuleText(textOf(n)) });
      if (k && !collapsed.has(n)) walk(kids(n), depth + 1);
    }
  };
  if (doc) walk(kids(body()), 0);
}

function render() {
  const host = $('#otree');
  const top = host.scrollTop;
  flatten();
  host.innerHTML = '';
  if (doc && !flat.length) host.append(el('div', 'onone', 'Empty outline — press Enter to start one.'));
  for (const item of flat) {
    if (item.isRule) {
      const hr = el('div', 'orule' + (item.n === cur ? ' sel' : ''));
      hr.style.marginLeft = (item.depth * 17) + 'px';
      hr.onclick = () => select(item.n);
      host.append(hr); continue;
    }
    const line = el('div', 'oline' + (item.hasKids ? '' : ' leaf') + (item.n === cur ? ' sel' : ''));
    line.style.marginLeft = (item.depth * 17) + 'px';
    const shut = collapsed.has(item.n);
    const tw = el('span', 'otw', item.hasKids ? (shut ? '▸' : '▾') : '·');
    if (item.hasKids) tw.onclick = ev => { ev.stopPropagation(); fold(item.n, !shut); };
    tw.ondblclick = ev => ev.stopPropagation();   // the arrow's two clicks already toggled twice
    line.append(tw);
    if (editing && item.n === cur) {
      // Standalone (Adam 11-11): a true editing BLOCK that wraps and grows, so the whole line is in view, and
      // shows bold, italics and links as they look. Ctrl+B / Ctrl+I / Ctrl+L work on the selected words only.
      // A line's text has no line breaks, so Enter still finishes and pasted text comes in plain, on one line.
      // CurryCaster II too (Adam 11-11: "Put the edit block in CurryCaster too"). The lines themselves stay as
      // they were in CurryCaster (words + ↗), so a click during the show never opens a browser.
      let inp;
      {
        inp = el('div', 'oedit block rich'); inp.contentEditable = 'true';
        inp.innerHTML = inlineHtml(decode(rawOf(item.n)));
        inp.dataset.orig = editValue(inp);
        if (spellApi()) {                // standalone: the app marks the words (all of them, at once), not Chromium
          let tm; inp.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => markEditBox(inp), 250); });
          inp.oncontextmenu = ev => editSpellMenu(ev, inp);
          setTimeout(() => markEditBox(inp));
        }
        inp.onpaste = ev => { ev.preventDefault();
          const t = (ev.clipboardData?.getData('text/plain') || '').replace(/\s*\r?\n\s*/g, ' ');
          document.execCommand('insertText', false, t); };
      }
      inp.spellcheck = spellOn && !spellRaw();          // the app marks words itself; off = nothing marks them
      inp.onkeydown = onEditKey;
      // Clicking away keeps what was typed. (A redraw that removes the box is not a click away.)
      inp.onblur = () => { if (editing && inp.isConnected && !askingLink) commitEdit(editValue(inp), false); };
      line.append(inp);
      host.append(line);
      setTimeout(() => { inp.focus();
        if (inp.isContentEditable) { const r = document.createRange(); r.selectNodeContents(inp); r.collapse(false);
                                     const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
        else inp.setSelectionRange(inp.value.length, inp.value.length); });
      continue;
    }
    const t = textOf(item.n);
    const media = STANDALONE ? mediaLabel(item.n) : null;
    const tx = el('span', 'otx' + (!media && !item.hasKids && t.length > 90 ? ' prose' : ''));
    if (media && item.n.getAttribute('type') === 'image' && /^https?:\/\//i.test(item.n.getAttribute('url') || '')) {
      // a picture line shows the picture (Adam 2026-11-18: "a picture that renders inline"), the file name under it
      const im = document.createElement('img');
      im.src = item.n.getAttribute('url'); im.alt = media; im.loading = 'lazy';
      im.style.cssText = 'display:block;max-width:100%;max-height:220px;height:auto;border-radius:4px;margin:2px 0;';
      im.onerror = () => { im.replaceWith(document.createTextNode(media)); };
      const cap = document.createElement('small'); cap.textContent = media; cap.style.cssText = 'opacity:.6;font-size:11px;';
      tx.append(im, cap);
    } else if (media) tx.textContent = media;
    else if (STANDALONE) {
      tx.innerHTML = inlineHtml(decode(rawOf(item.n))) || '<span class="oempty">&nbsp;</span>';
      for (const a of tx.querySelectorAll('a')) { a.target = '_blank'; a.rel = 'noopener'; a.title = a.href; a.onclick = ev => ev.stopPropagation(); }
    }
    else tx.innerHTML = richText(t) || '<span class="oempty">&nbsp;</span>';
    const ty = STANDALONE && item.n.getAttribute('type');
    if (ty && !['link', 'image', 'audio', 'video'].includes(ty)) tx.append(el('span', 'otype', ty));
    line.append(tx);
    const u = STANDALONE ? (item.n.getAttribute('url') || item.n.getAttribute('xmlUrl') || item.n.getAttribute('htmlUrl') || '') : linkOf(item.n);
    if (u) { const a = el('a', null, ' ↗'); a.href = u; a.target = '_blank'; a.rel = 'noopener'; a.title = u;
             a.onclick = ev => ev.stopPropagation(); line.append(a); }
    // Clicking SELECTS. Nothing else: the outline does not touch the clip browser (Adam, 10-05).
    line.onclick = () => select(item.n);
    line.oncontextmenu = ev => spellMenu(ev, item);
    // Double-click SELECTS and opens/closes the line (Adam, 10-20). Editing is Escape (or F2) only.
    line.ondblclick = () => { select(item.n); if (item.hasKids) fold(item.n, !collapsed.has(item.n)); };
    host.append(line);
  }
  // Room below the last line, as tall as the window, so the wheel can bring the bottom lines up to
  // the top and read them there during the show (Adam, 10-20: "I want to be able to keep scrolling").
  if (doc && flat.length) { const tail = el('div', 'otail'); tail.style.height = tailHeight(host) + 'px'; host.append(tail); }
  host.scrollTop = top;
  if (!editing) window.CSS?.highlights?.delete('ospell');
  watchSpelling(host);
  $('#ocount').textContent = doc ? `${flat.filter(x => !x.isRule).length} lines` : '';
  $('#otree .sel')?.scrollIntoView({ block: 'nearest' });
  paintState();
}

function paintState() {
  const s = $('#osave');
  if (!s) return;
  s.disabled = !dirty;
  s.textContent = dirty ? 'Save ●' : 'Saved';
  s.classList.toggle('primary', dirty);
  window.dispatchEvent(new Event('sc:outline-state'));      // the standalone app shows ● in its title
}

// the last line can scroll up to the top edge: window height minus one line and the padding
function tailHeight(host) { return Math.max(0, host.clientHeight - 32); }

function select(n) { cur = n; if (!editing) { render(); $('#otree').focus(); } }
function fold(n, shut) { if (shut) collapsed.add(n); else collapsed.delete(n); render(); }

/* ---------------------------------------------------------------- edits (every one undoable) */
function snapshot() {
  undoStack.push({ xml: serialize(), sel: pathOf(cur), shut: shutPaths() });
  if (undoStack.length > 200) undoStack.shift();
  redoStack = [];
  dirty = true;
}
function pathOf(n) {
  if (!n) return null;
  const p = [];
  for (let x = n; x && x.tagName === 'outline'; x = x.parentElement) p.unshift(kids(x.parentElement).indexOf(x));
  return p;
}
function byPath(p) {
  if (!p) return null;
  let x = body();
  for (const i of p) { x = kids(x)[i]; if (!x) return null; }
  return x;
}
function shutPaths() { const out = []; body()?.querySelectorAll('outline').forEach(n => { if (collapsed.has(n)) out.push(pathOf(n)); }); return out; }
function restore(state) {
  load(state.xml);
  collapsed = new WeakSet();
  for (const p of state.shut) { const n = byPath(p); if (n) collapsed.add(n); }
  cur = byPath(state.sel);
}
function undo() { if (!undoStack.length) return; redoStack.push({ xml: serialize(), sel: pathOf(cur), shut: shutPaths() }); restore(undoStack.pop()); dirty = true; render(); }
function redo() { if (!redoStack.length) return; undoStack.push({ xml: serialize(), sel: pathOf(cur), shut: shutPaths() }); restore(redoStack.pop()); dirty = true; render(); }

function newLine() {
  if (!doc) return;
  snapshot();
  const n = doc.createElement('outline');
  n.setAttribute('text', '');
  if (cur) {
    // On an open line with children, the new line goes first under it — where the eye is.
    if (kids(cur).length && !collapsed.has(cur)) kids(cur)[0].before(n); else cur.after(n);
  } else body().append(n);
  cur = n; editing = true; render();
}
function indent() {
  if (!cur) return;
  let prev = cur.previousElementSibling;
  while (prev && prev.tagName !== 'outline') prev = prev.previousElementSibling;
  if (!prev) return;
  snapshot(); prev.append(cur); collapsed.delete(prev); render();
}
function outdent() {
  if (!cur || cur.parentElement.tagName !== 'outline') return;
  snapshot(); cur.parentElement.after(cur); render();
}
function move(dir) {
  if (!cur) return;
  let sib = dir < 0 ? cur.previousElementSibling : cur.nextElementSibling;
  while (sib && sib.tagName !== 'outline') sib = dir < 0 ? sib.previousElementSibling : sib.nextElementSibling;
  if (!sib) return;
  snapshot(); if (dir < 0) sib.before(cur); else sib.after(cur); render();
}
function remove() {
  if (!cur) return;
  const i = flat.findIndex(x => x.n === cur);
  snapshot();
  const gone = cur; gone.remove();
  flatten();
  cur = flat[Math.min(i, flat.length - 1)]?.n || null;
  render();
}
function copy() { if (cur) { clip = cur.cloneNode(true); say(`outline: copied "${textOf(cur).slice(0, 40)}"`); } }
function cut() { if (cur) { copy(); remove(); } }
function paste() {
  if (!clip || !doc) return;
  snapshot();
  const n = doc.importNode(clip, true);
  if (cur) cur.after(n); else body().append(n);
  cur = n; render();
}

/*
 * PASTE AS NODES (2.3.7, Adam: "a function we had in our original OPML editor"). The same rules as
 * opml-outliner.py paste_as_nodes: blank lines separate blocks; the FIRST line of a block is a
 * new line in the outline, the rest of the block its children; a one-line block has no children.
 * The new lines go after the selected line (at its level), or at the end. One undo removes them all.
 */
export function nodesFromText(raw) {
  const out = [];
  for (const block of String(raw || '').replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/)) {
    const lines = block.split('\n').filter(l => l.trim()).map(l => l.trim());   // indentation in pasted text is not part of a line
    if (lines.length) out.push({ text: lines[0], children: lines.slice(1) });
  }
  return out;
}
async function pasteAsNodes() {
  if (!doc) return say('open an outline first', true);
  if (!askText) return;
  const raw = await askText({ title: 'Paste as Nodes', multiline: true, ok: 'Create nodes',
    note: 'Paste text below. A blank line starts a new line in the outline. The first line of each block is the parent; the lines under it become its children.' });
  if (raw == null) return;
  const blocks = nodesFromText(raw);
  if (!blocks.length) return;
  snapshot();
  const made = blocks.map(b => {
    const n = doc.createElement('outline');
    n.setAttribute('text', b.text);
    for (const c of b.children) { const k = doc.createElement('outline'); k.setAttribute('text', c); n.append(k); }
    return n;
  });
  let at = cur;
  for (const n of made) { if (at) at.after(n); else body().append(n); at = n; }
  cur = made[0]; collapsed.delete(made[0]);
  render(); $('#otree').focus();
  say(`outline: ${made.length} line${made.length === 1 ? '' : 's'} pasted as nodes`);
}

/*
 * LINKS (2.3.7, Adam: "I need to be able to add links to the opml"). Stored as Adam's outliner
 * stores them, type="link" url="…", so both editors and Currycaster read the same file. An empty
 * box removes the link — the url attribute and an <a href> inside the text alike.
 */
async function editLink() {
  if (!doc || !cur) return say('select a line first', true);
  if (!askText) return;
  const was = linkOf(cur);
  const u = await askText({ title: was ? 'Change link' : 'Add link', value: was, ok: 'OK',
    note: `On "${textOf(cur).slice(0, 60)}". Leave it empty to remove the link.` });
  if (u == null || u === was) { $('#otree').focus(); return; }
  snapshot();
  const text = textOf(cur);
  if (/<a\s[^>]*href=/i.test(decode(rawOf(cur)))) cur.setAttribute('text', text);   // the link moves out of the text
  if (u) {
    cur.setAttribute('url', u);
    if (!cur.getAttribute('type')) cur.setAttribute('type', 'link');
  } else {
    for (const a of ['url', 'htmlUrl']) cur.removeAttribute(a);
    if (cur.getAttribute('type') === 'link') cur.removeAttribute('type');
  }
  render(); $('#otree').focus();
  say(u ? `outline: link set — ${u}` : 'outline: link removed');
}

function startEdit() { if (!cur) return; editing = true; render(); }
function commitEdit(value, keepEditing) {
  const rich = $('#otree .oedit.rich');
  if (rich && cur) {                      // standalone rich box: the value IS the stored text (markup and links)
    if (value !== rich.dataset.orig) { snapshot(); cur.setAttribute('text', value); }
  } else if (cur && value !== textOf(cur)) {
    snapshot();
    // A link inside the text (<a href="…">words</a>, as cart and the NA archive store it) STAYS in the text:
    // only the words change (Adam, 10-21: editing "Meat Muck" in the archive lost the 1913 link on the page).
    const raw = decode(rawOf(cur));
    const m = raw.match(/^([^<]*)(<a\s[^>]*href="[^"]*"[^>]*>)([^<]*)<\/a>([^<]*)$/i);
    if (m) {
      const [, pre, open, , post] = m;
      const inner = value.startsWith(pre) && value.endsWith(post) && value.length >= pre.length + post.length
        ? value.slice(pre.length, value.length - post.length) : null;
      cur.setAttribute('text', inner !== null ? pre + open + inner + '</a>' + post : open + value + '</a>');
    } else {
      // Several links in one line: the first is kept as the line's link (type="link" so a page still links it).
      const link = linkOf(cur);
      if (link && !cur.getAttribute('url')) { cur.setAttribute('url', link); if (!cur.getAttribute('type')) cur.setAttribute('type', 'link'); }
      cur.setAttribute('text', value);
    }
  }
  editing = !!keepEditing;
  render();
  if (!editing) $('#otree').focus();
}
function wrap(inp, tag) {
  const a = inp.selectionStart, b = inp.selectionEnd, v = inp.value;
  inp.value = v.slice(0, a) + `<${tag}>` + v.slice(a, b) + `</${tag}>` + v.slice(b);
  inp.setSelectionRange(b + tag.length * 2 + 5, b + tag.length * 2 + 5);
}

/* ---------------------------------------------------------------- cart.curry.com editor features
 * Adam, 2026-10-21 (cart.curry.com retired, publishing moved to cartpub on helix): "Look at all of the different
 * attributes it has... This is critical". Every rule below is cart's own (Cartulary scripts/editor.js), so a page
 * made here renders exactly as one made in cart's editor: the node Type menu, Attach (upload → image / video /
 * audio / link line), Include (an outline's lines under a type="include" line), and expansionState on publish. */
const URL_IN_TEXT = /(ftp|http|https):\/\/(\w+:{0,1}\w*@)?(\S+)(:[0-9]+)?(\/|\/([\w#!:.?+=&%@!\-\/]))?/;
const urlInText = n => (URL_IN_TEXT.exec(rawOf(n)) || [''])[0];
function headEl() {
  let head = doc.querySelector('opml > head');
  if (!head) { head = doc.createElement('head'); doc.documentElement.prepend(head); }
  return head;
}
/*
 * expansionState as CART'S PAGE BUILDER reads it — not a plain visible-line count. Cartulary's
 * buildHtmlFromOpmlRecursive walks a counter through EVERY line, hidden ones too; a hidden line inside a shut
 * section whose counter is in the list also counts as "open" and pushes the counter on, so a plain count opens
 * the wrong section after a shut one (found by test, 2026-10-21). So: simulate cart's counter, and add the
 * counter of the first visible line that should be open but is not, until the page matches the editor.
 */
function cartCounters(es) {
  const at = new Map();
  const rec = (nodes, indent, expand, expanded) => {
    for (const x of nodes) {
      const ex = es.has(expand);
      at.set(x, { c: expand, ex });
      const ne = (expanded || ex) ? expand + 1 : expand;
      expand = rec(kids(x), indent + 1, ne, ex);
      if (indent === 0 && !ex) expand++;
    }
    return expand;
  };
  rec(kids(body()), 0, 1, false);
  return at;
}
// Open/shut from <head><expansionState> read the way cart's page builder reads it (so the editor shows
// what the published page shows). False when there is none.
function esFold() {
  const raw = doc.querySelector('opml > head > expansionState')?.textContent || '';
  const es = new Set(raw.split(',').map(x => parseInt(x, 10)).filter(Number.isFinite));
  if (!es.size) return false;
  const at = cartCounters(es);
  collapsed = new WeakSet();
  for (const n of body().querySelectorAll('outline')) if (kids(n).length && !at.get(n).ex) collapsed.add(n);
  return true;
}
function expansionState() {
  const es = new Set();
  const want = n => kids(n).length > 0 && !collapsed.has(n);
  for (let guard = 0; guard < 10000; guard++) {
    const at = cartCounters(es);
    let fix = null;
    const walk = nodes => { for (const x of nodes) { if (fix) return;
      if (want(x) && !at.get(x).ex) { fix = at.get(x).c; return; }
      if (want(x)) walk(kids(x)); } };
    walk(kids(body()));
    if (fix == null) break;
    es.add(fix);
  }
  return [...es].sort((a, b) => a - b).join(',');
}
function setType(t, url) {
  if (!doc || !cur) return say('select a line first', true);
  snapshot();
  if (t === 'none') { for (const a of ['icon', 'type', 'url']) cur.removeAttribute(a); render(); return; }
  cur.setAttribute('type', t);
  if (t === 'image' || t === 'enclosure') {
    if (!cur.getAttribute('url')) {
      const inText = urlInText(cur);
      if (inText) cur.setAttribute('url', inText);
      else if (url) { cur.setAttribute('url', url); cur.setAttribute('text', t === 'image' ? `<img src="${url}">` : url); }
    }
    cur.setAttribute('icon', t === 'image' ? 'image' : 'file-audio-o');
  } else if (url) cur.setAttribute('url', url);
  if (t === 'description') cur.setAttribute('icon', 'newspaper-o');
  if (t === 'collaborate') cur.setAttribute('text', '[Collaboration node - do not delete.]');
  render();
  if (t === 'presentation') say('Now build your slideshow structure as children below this line.');
}
const isImage = u => /\.(jpe?g|png|gif|webp|svg|bmp)(\?|$)/i.test(u);
const isVideo = u => /\.(mp4|m4v|mov|webm|ogv)(\?|$)/i.test(u);
const isAudio = u => /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)(\?|$)/i.test(u);
/** Attach: {url, name, type (mime), length} of an uploaded file → a new line after the selected one, as cart made it. */
function insertMedia({ url, name, type, length }) {
  if (!doc) return;
  snapshot();
  const n = doc.createElement('outline');
  const set = o => { for (const [k, v] of Object.entries(o)) n.setAttribute(k, v); };
  set({ text: '' , created: new Date().toUTCString() });
  // 600 px wide as cart made it, but never wider than the page: phones get it scaled to fit (Adam 2026-11-18)
  if (isImage(url)) set({ text: `<img src="${url}" style="width:100%;max-width:600px;height:auto;">`, type: 'image', icon: 'image', url });
  else if (isVideo(url)) set({ text: `<video style="width:95%;margin:0 auto;display:block;" controls="true" preload="none"><source src="${url}" type="${type}"></video>`, type: 'video', icon: 'video-camera', url });
  else if (isAudio(url)) set({ text: `<audio style="width:400px; vertical-align:middle;" controls="true" preload="none"><source src="${url}" type="${type}"></audio> <a class="audiocaption" style="vertical-align:middle;" href="${url}">${name}</a>`, type: 'audio', icon: 'volume-up', url });
  else set({ text: `<a href="${url}">${name}</a>`, type: 'link', url, mimetype: type, length: String(length) });
  if (cur) cur.after(n); else body().append(n);
  cur = n; render(); $('#otree').focus();
}
/** Include: the line becomes type="include" url=…, and (if it has no lines under it yet) the outline's lines go under it. */
function setInclude(url, xml) {
  if (!doc || !cur) return 'select a line first';
  let b = null;
  if (xml) {
    const d = new DOMParser().parseFromString(xml, 'text/xml');
    b = d.querySelector('body');
    if (d.querySelector('parsererror') || !b) return 'that address did not return a valid OPML outline';
  }
  snapshot();
  cur.setAttribute('type', 'include'); cur.setAttribute('url', url);
  if (b && !kids(cur).length) for (const o of [...b.children].filter(c => c.tagName === 'outline')) cur.append(doc.importNode(o, true));
  render(); return null;
}
// What a media line shows in the editor (its text is raw HTML for the published page)
function mediaLabel(n) {
  const t = n.getAttribute('type'), u = n.getAttribute('url') || '';
  const file = decodeURIComponent(u.split('/').pop() || '');
  if (t === 'image') return `🖼 ${file}`;
  if (t === 'video') return `🎞 ${file}`;
  if (t === 'audio') return `🔊 ${(decode(rawOf(n)).match(/class="audiocaption"[^>]*>([^<]*)</) || [])[1] || file}`;
  return null;
}

/* ---------------------------------------------------------------- keys */
function onEditKey(e) {
  const inp = e.target.closest?.('.oedit') || e.target, ctrl = e.ctrlKey || e.metaKey, rich = inp.isContentEditable;
  let done = true;
  if (e.key === 'Enter' || e.key === 'Escape') commitEdit(editValue(inp), false);
  else if (e.key === 'Tab') { commitEdit(editValue(inp), true); e.shiftKey ? outdent() : indent(); }
  else if (ctrl && (e.key === 'b' || e.key === 'B')) rich ? document.execCommand('bold') : wrap(inp, 'b');
  else if (ctrl && (e.key === 'i' || e.key === 'I')) rich ? document.execCommand('italic') : wrap(inp, 'i');
  else if (ctrl && (e.key === 's' || e.key === 'S')) { commitEdit(editValue(inp), false); save(); }
  else if (ctrl && (e.key === 'l' || e.key === 'L')) {
    e.preventDefault(); e.stopPropagation();
    if (rich) { linkSelection(inp).then(did => { if (!did) { commitEdit(editValue(inp), false); editLink(); } }); return; }
    commitEdit(inp.value, false); editLink();
  }
  else done = false;
  if (done) { e.preventDefault(); }
  e.stopPropagation();          // typing here must never fire the desk's M / T / F-keys
}

function onKey(e) {
  if (!doc || editing) return;
  const ctrl = e.ctrlKey || e.metaKey, k = e.key;
  const i = flat.findIndex(x => x.n === cur);
  const step = d => { let j = i < 0 ? (d > 0 ? -1 : flat.length) : i;
                      do { j += d; } while (flat[j]?.isRule); if (flat[j]) { cur = flat[j].n; render(); } };
  let done = true;
  if (k === 'ArrowDown' && !ctrl) step(1);
  else if (k === 'ArrowUp' && !ctrl) step(-1);
  else if (k === 'ArrowRight' && cur) { if (kids(cur).length && collapsed.has(cur)) fold(cur, false); else step(1); }
  else if (k === 'ArrowLeft' && cur) {
    if (kids(cur).length && !collapsed.has(cur)) fold(cur, true);
    else if (cur.parentElement.tagName === 'outline') { cur = cur.parentElement; render(); }
  }
  else if (k === 'Enter' && ctrl && !e.shiftKey) {
    const u = cur && linkOf(cur);
    if (u) window.open(u, '_blank', 'noopener'); else if (cur && kids(cur).length) fold(cur, !collapsed.has(cur));
    else if (cur) editLink();                     // no link, no children: offer one (as the original does)
  }
  else if (k === 'Enter') newLine();
  else if (k === 'F2' || k === 'Escape') startEdit();
  else if (k === 'Tab') e.shiftKey ? outdent() : indent();
  else if (ctrl && (k === 'u' || k === 'U' || k === 'ArrowUp')) move(-1);
  else if (ctrl && (k === 'd' || k === 'D' || k === 'ArrowDown')) move(1);
  else if (k === 'Delete') remove();
  else if (ctrl && (k === 'c' || k === 'C')) copy();
  else if (ctrl && (k === 'x' || k === 'X')) cut();
  else if (ctrl && e.shiftKey && (k === 'v' || k === 'V')) pasteAsNodes();
  else if (ctrl && (k === 'v' || k === 'V')) paste();
  else if (ctrl && (k === 'l' || k === 'L')) editLink();
  else if (ctrl && (k === 'z' || k === 'Z')) (e.shiftKey ? redo : undo)();
  else if (ctrl && (k === 'y' || k === 'Y')) redo();
  else if (ctrl && (k === 's' || k === 'S')) save();
  else done = false;
  if (done) { e.preventDefault(); e.stopPropagation(); }
}

/* ---------------------------------------------------------------- saving */
export const outlineDirty = () => dirty;

/** Save. Refused (and the operator asked) if the file changed on disk since it was opened. */
/** What is open now, for the show to remember: a library path, or { abs } for one opened by hand. */
export function currentOutline() { return rel ? (typeof rel === 'string' ? { rel } : { abs: rel.abs }) : null; }

export async function save(force = false) {
  if (!doc || !rel) return true;
  if (editing) { const inp = $('#otree .oedit'); if (inp) commitEdit(editValue(inp), false); }
  if (STANDALONE) {
    // Ctrl+S also keeps a new SHAPE (open lines, selection) with no edits, so the file reopens as it was saved
    const before = serialize();
    writeFileState();
    if (!dirty && !force && serialize() === before) return true;
  } else if (!dirty && !force) return true;
  const r = await window.studiocast.opml.save({ rel, xml: serialize(), mtimeMs, force });
  if (r.ok) { mtimeMs = r.mtimeMs; dirty = false; conflictBar(null); paintState(); say(`outline saved: ${r.path.split('/').pop()}`); return true; }
  if (r.conflict) {
    conflictBar('This outline was changed on disk after you opened it (Sam may have shipped a new version). Nothing was saved.',
      [['Load the version on disk', async () => { dirty = false; await openOutline(rel); }],
       ['Save mine over it', () => save(true)]]);
    return false;
  }
  say(`outline NOT saved: ${r.error}`, true);
  return false;
}

function conflictBar(text, actions = []) {
  let bar = $('#oconflict');
  if (!text) { bar?.remove(); return; }
  if (!bar) { bar = el('div', 'oconflict'); bar.id = 'oconflict'; $('#otree').before(bar); }
  bar.innerHTML = '';
  bar.append(el('div', null, text));
  for (const [label, fn] of actions) { const b = el('button', null, label); b.onclick = fn; bar.append(b); }
}

/** For the end-to-end test. */
window.__outline = { get dirty() { return dirty; }, get cur() { return cur ? textOf(cur) : null; },
                     lines: () => flat.filter(x => !x.isRule).map(x => ({ t: textOf(x.n), d: x.depth })),
                     xml: () => (doc ? serialize() : null) };
