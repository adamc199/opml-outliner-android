// Stand-in for Bridge.kt in the web test: same call/resolve contract. godcaster = a real outliner-sync
// (test mode) on 127.0.0.1:18795; "this phone" = an in-memory file store.
(() => {
  const SRV = 'http://127.0.0.1:18795';
  const phone = { 'content://phone/Notes.opml': { xml: '<?xml version="1.0"?>\n<opml version="2.0"><head/><body><outline text="phone line"/></body></opml>\n', m: 1000 } };
  const CP = 'http://127.0.0.1:18796';      // a DRY cartpub (run.sh): writes to a temp folder, never to S3
  const st = { recent: [], last: null, server: SRV, pub: {}, hash: {} };
  window.__mock = { phone, st, calls: [] };
  const done = (id, v) => setTimeout(() => window.__resolve(id, JSON.stringify(v)), 5);
  window.Android = { call(id, method, arg) {
    const a = arg ? JSON.parse(arg) : {}; window.__mock.calls.push(method);
    const j = r => r.json();
    const run = {
      remoteRecent: () => fetch(SRV + '/v1/recent').then(j),
      cartGet: () => fetch(CP + a.path).then(j),
      cartPost: () => fetch(CP + a.path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a.body) }).then(j),
      cartUpload: () => fetch(CP + '/api/upload?name=' + encodeURIComponent('09 10- Phone clip.mp3'), { method: 'POST', body: new Uint8Array(3000) }).then(j),
      fetchUrl: () => fetch(a.url).then(r => r.text()).then(xml => ({ xml })),
      pubRead: () => Promise.resolve({ xml: st.pub[a.name]?.xml ?? null, hash: st.hash[a.name] ?? null }),
      pubWrite: () => Promise.resolve((st.pub[a.name] = { xml: a.xml, m: Date.now() }, { ok: true })),
      pubMark: () => Promise.resolve((st.hash[a.name] = a.hash, { ok: true })),
      read: () => a.abs.startsWith('pub:') ? Promise.resolve((st.last = a.abs, { xml: st.pub[a.abs.slice(4)].xml, mtimeMs: st.pub[a.abs.slice(4)].m, path: a.abs }))
        : a.abs.startsWith('gc:') ? fetch(SRV + '/v1/file?path=' + encodeURIComponent(a.abs.slice(3))).then(j).then(r => { st.last = a.abs; return r; })
        : Promise.resolve(phone[a.abs] ? (st.last = a.abs, st.recent = [{ abs: a.abs, name: a.abs.split('/').pop(), t: Date.now() }, ...st.recent.filter(x => x.abs !== a.abs)], { xml: phone[a.abs].xml, mtimeMs: phone[a.abs].m }) : { error: 'gone' }),
      save: () => a.rel.abs.startsWith('pub:') ? Promise.resolve((() => { const f = st.pub[a.rel.abs.slice(4)]; f.xml = a.xml; f.m += 1000; return { ok: true, mtimeMs: f.m, path: a.rel.abs }; })())
        : a.rel.abs.startsWith('gc:')
        ? fetch(SRV + '/v1/file', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: a.rel.abs.slice(3), xml: a.xml, mtimeMs: a.mtimeMs, force: a.force }) }).then(j)
        : Promise.resolve((() => { const f = phone[a.rel.abs]; if (!a.force && a.mtimeMs && Math.abs(f.m - a.mtimeMs) > 1) return { conflict: true };
            f.xml = a.xml; f.m += 1000; return { ok: true, mtimeMs: f.m, path: a.rel.abs }; })()),
      localRecent: () => Promise.resolve({ files: st.recent }),
      pickPicture: () => fetch(CP + '/api/upload?name=' + encodeURIComponent('IMG_2041.jpg'), { method: 'POST', body: new Uint8Array(5000) }).then(j).then(r => ({ ...r, width: 1600, height: 1200 })),
      createText: () => Promise.resolve((st.saved = { name: a.name, mime: a.mime, text: a.text }, { ok: true, name: a.name })),
      prefGet: () => Promise.resolve({ value: (st.prefs || {})[a.key] ?? null }),
      prefSet: () => Promise.resolve(((st.prefs = st.prefs || {})[a.key] = a.value, { ok: true })),
      forgetLocal: () => Promise.resolve({ ok: true }),
      getServer: () => Promise.resolve({ server: st.server }),
      setServer: () => Promise.resolve({ ok: true }),
      lastFile: () => Promise.resolve({ abs: st.last }),
      choose: () => Promise.resolve({ abs: 'content://phone/Notes.opml', name: 'Notes.opml' }),
      create: () => Promise.resolve(null),
      openUrl: () => Promise.resolve({ ok: true }),
    }[method];
    (run ? run() : Promise.resolve({ error: 'unknown' })).then(v => done(id, v), e => done(id, { error: String(e) }));
  } };
})();
