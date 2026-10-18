import { safeURL } from './core.js';

// Keep invalid nonblank lines so the import preview can explain skipped entries.
export function parseOneTab(text) {
  return String(text ?? '').split(/\r\n?|\n/).flatMap(line => {
    const trimmed = line.trim();
    if (!trimmed) return [];
    const separator = /\s+\|\s*/.exec(trimmed);
    if (!separator) return [{ title: '', url: trimmed }];
    return [{
      url: trimmed.slice(0, separator.index).trim(),
      title: trimmed.slice(separator.index + separator[0].length).trim()
    }];
  });
}

// Parse into a detached, inert document. Never attach imported markup to the UI.
export function parseBookmarksHTML(text, DOMParserType = globalThis.DOMParser) {
  if (typeof DOMParserType !== 'function') throw new Error('当前环境无法读取收藏夹 HTML 文件。');
  const document = new DOMParserType().parseFromString(String(text ?? ''), 'text/html');
  return Array.from(document.querySelectorAll('a[href]'), anchor => ({
    title: anchor.textContent.trim(),
    url: anchor.getAttribute('href').trim()
  }));
}

export function flattenBookmarks(nodes) {
  const entries = [];
  const pending = Array.isArray(nodes) ? [...nodes].reverse() : [];
  const visited = new Set();
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== 'object' || visited.has(node)) continue;
    visited.add(node);
    if (Object.hasOwn(node, 'url')) entries.push({ title: node.title, url: node.url });
    if (Array.isArray(node.children)) {
      for (let index = node.children.length - 1; index >= 0; index--) pending.push(node.children[index]);
    }
  }
  return entries;
}

export function prepareWebsiteImport(entries, existingCards = [], limit = 200) {
  const cards = [];
  let duplicates = 0;
  let invalid = 0;
  let truncated = 0;
  const existing = Array.isArray(existingCards) ? existingCards : [];
  const capacity = Math.max(0, Math.floor(Number.isFinite(limit) ? limit : 200) - existing.length);
  const seen = new Set();
  for (const card of existing) {
    if (card?.type !== 'website' || typeof card.url !== 'string') continue;
    try { seen.add(safeURL(card.url.trim())); } catch { /* A malformed existing card must not stop an import. */ }
  }
  for (const entry of Array.isArray(entries) ? entries : []) {
    let url;
    try {
      if (typeof entry?.url !== 'string' || !entry.url.trim()) throw new Error('Missing URL');
      url = safeURL(entry.url.trim());
    } catch {
      invalid++;
      continue;
    }
    if (seen.has(url)) {
      duplicates++;
      continue;
    }
    seen.add(url);
    if (cards.length >= capacity) {
      truncated++;
      continue;
    }
    const title = typeof entry.title === 'string' ? entry.title.trim() : '';
    cards.push({
      id: crypto.randomUUID(), type: 'website', title: (title || new URL(url).hostname).slice(0, 120),
      url, icon: '', height: 220
    });
  }
  return { cards, duplicates, invalid, truncated };
}
