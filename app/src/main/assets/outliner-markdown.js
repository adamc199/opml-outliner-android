// OPML outline -> Markdown, for "Save as Markdown" and "Publish as Markdown" (Adam 2026-11-18).
// The Markdown follows the Markdown-web pages BonBon and MD Web read: plain Markdown, no HTML.
//
// How an outline becomes a page:
//   - a top-level line with no lines under it   -> a paragraph
//   - a top-level line WITH lines under it      -> a "## heading", its lines as a bulleted list (nested as deep as the outline)
//   - Link lines (type link + url)              -> [text](url)
//   - Image lines (type image + url)            -> ![](url) (alone in a paragraph = centered with its caption in BonBon)
//   - Code lines                                -> a fenced code block with the lines under it
//   - comments (isComment) and empty lines      -> left out
//   - HTML inside a line: <a> -> [text](url), <b>/<strong> -> **, <i>/<em> -> _, <img> -> ![](src), <br> -> line break,
//     every other tag dropped (a Markdown-web reader throws HTML away anyway)

const kids = el => [...el.children].filter(c => c.tagName === 'outline');

/** a line's text (which may hold cart-style HTML) as Markdown inline text */
export function inline(text) {
  if (!text) return '';
  if (!/[<&]/.test(text)) return text;
  const doc = new DOMParser().parseFromString(`<div>${text}</div>`, 'text/html');
  const walk = n => {
    if (n.nodeType === 3) return n.nodeValue;
    if (n.nodeType !== 1) return '';
    const t = n.tagName.toLowerCase(), inner = () => [...n.childNodes].map(walk).join('');
    if (t === 'a') { const h = n.getAttribute('href'), s = inner().trim(); return h ? `[${s || h}](${h})` : s; }
    if (t === 'b' || t === 'strong') { const s = inner(); return s.trim() ? `**${s.trim()}**` : s; }
    if (t === 'i' || t === 'em') { const s = inner(); return s.trim() ? `_${s.trim()}_` : s; }
    if (t === 'code') return '`' + inner() + '`';
    if (t === 'img') { const s = n.getAttribute('src'); return s ? `![${n.getAttribute('alt') || ''}](${s})` : ''; }
    if (t === 'br') return '  \n';
    if (t === 'script' || t === 'style') return '';
    return inner();
  };
  return walk(doc.body.firstChild).replace(/[ \t]+\n/g, m => m.includes('  \n') ? '  \n' : '\n');
}

function lineText(el) {
  const type = (el.getAttribute('type') || '').toLowerCase(), url = el.getAttribute('url') || '';
  const text = inline(el.getAttribute('text') || '').trim();
  if (type === 'image' && url) return `![${/!\[/.test(text) ? '' : text.replace(/[[\]]/g, '')}](${url})`;
  if ((type === 'link' || type === 'include' || type === 'redirect' || type === 'enclosure') && url && !text.includes(`](${url})`))
    return `[${text || url}](${url})`;
  return text;
}

const skip = el => el.getAttribute('isComment') === 'true' || (!(el.getAttribute('text') || '').trim() && !kids(el).length);

function codeBlock(el) {
  const lines = [];
  const walk = (e, d) => { for (const k of kids(e)) { lines.push('  '.repeat(d) + (k.getAttribute('text') || '')); walk(k, d + 1); } };
  walk(el, 0);
  const head = (el.getAttribute('text') || '').trim();
  return (head ? inline(head) + '\n\n' : '') + '```\n' + lines.join('\n') + '\n```';
}

function list(el, depth, out) {
  for (const k of kids(el)) {
    if (skip(k)) continue;
    if ((k.getAttribute('type') || '') === 'code') { out.push(codeBlock(k).split('\n').map(l => '  '.repeat(depth) + l).join('\n')); continue; }
    out.push('  '.repeat(depth) + '- ' + lineText(k).replace(/\n/g, '\n' + '  '.repeat(depth + 1)));
    list(k, depth + 1, out);
  }
}

/** -> { title, markdown } ; markdown is the page body (no front matter, no title line) */
export function opmlToMarkdown(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('the outline is not well-formed OPML');
  const title = (doc.querySelector('head > title')?.textContent || '').trim();
  const body = doc.querySelector('body');
  const blocks = [];
  for (const el of body ? kids(body) : []) {
    if (skip(el)) continue;
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'code') { blocks.push(codeBlock(el)); continue; }
    if (!kids(el).filter(k => !skip(k)).length) { blocks.push(lineText(el)); continue; }
    const items = [];
    list(el, 0, items);
    blocks.push(`## ${lineText(el).replace(/\n+/g, ' ')}\n\n${items.join('\n')}`);
  }
  return { title, markdown: blocks.join('\n\n') + '\n' };
}
