import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOneTab, parseBookmarksHTML, flattenBookmarks, prepareWebsiteImport } from '../importers.js';

test('OneTab groups, URL-only lines, Unicode titles and pipes in titles are retained in order', () => {
  assert.deepEqual(parseOneTab('\uFEFFhttps://example.com | 示例网站\r\n\r\nhttps://example.org/path#part\n https://example.net | A | B \r'), [
    { title: '示例网站', url: 'https://example.com' },
    { title: '', url: 'https://example.org/path#part' },
    { title: 'A | B', url: 'https://example.net' }
  ]);
  assert.deepEqual(parseOneTab('https://example.com/?q=a|b | 搜索'), [{ title: '搜索', url: 'https://example.com/?q=a|b' }]);
  assert.deepEqual(parseOneTab(null), []);
  assert.deepEqual(parseOneTab(' \n\r\n'), []);
});

test('invalid nonblank OneTab lines become visible in the skipped count', () => {
  const result = prepareWebsiteImport(parseOneTab('not a URL\n\nhttps://example.com | 网页\njavascript:alert(1) | Script\nhttps://example.org |'));
  assert.equal(result.cards.length, 2);
  assert.equal(result.cards[1].title, 'example.org');
  assert.equal(result.invalid, 2);
});

test('bookmark HTML uses detached text/html parsing, raw href attributes and decoded text content', () => {
  const markup = '<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><DT><A HREF="https://example.com/?a=1&amp;b=2">A &amp; B</A></DL>';
  let called = false;
  class InertParser {
    parseFromString(input, type) {
      assert.equal(input, markup);
      assert.equal(type, 'text/html');
      called = true;
      return { querySelectorAll(selector) {
        assert.equal(selector, 'a[href]');
        return [
          { textContent: ' A & B ', getAttribute(name) { assert.equal(name, 'href'); return 'https://example.com/?a=1&b=2'; } },
          { textContent: 'relative', getAttribute() { return '/local'; } },
          { textContent: 'script', getAttribute() { return 'javascript:alert(1)'; } }
        ];
      } };
    }
  }
  const entries = parseBookmarksHTML(markup, InertParser);
  assert.ok(called);
  assert.equal(entries[0].title, 'A & B');
  assert.equal(entries[0].url, 'https://example.com/?a=1&b=2');
  const prepared = prepareWebsiteImport(entries);
  assert.equal(prepared.cards.length, 1);
  assert.equal(prepared.invalid, 2);
  assert.throws(() => parseBookmarksHTML('', null), /HTML/);
});

test('bookmark trees flatten nested folders in displayed order without importing folders', () => {
  const tree = [{ id: '0', title: '', children: [
    { id: '1', title: '收藏夹栏', children: [
      { id: '2', title: 'A', url: 'https://a.example' },
      { id: '3', title: '项目', children: [{ id: '4', title: 'B', url: 'https://b.example' }] }
    ] },
    { id: '5', title: '其他收藏夹', children: [{ id: '6', title: 'C', url: 'https://c.example' }] },
    { id: '7', title: '空文件夹', children: [] }
  ] }];
  assert.deepEqual(flattenBookmarks(tree), [
    { title: 'A', url: 'https://a.example' }, { title: 'B', url: 'https://b.example' }, { title: 'C', url: 'https://c.example' }
  ]);
  assert.deepEqual(flattenBookmarks(null), []);
});

test('malformed bookmark nodes and cyclic trees do not cause hangs', () => {
  const node = { title: 'A', url: 'https://a.example', children: [] };
  node.children.push(node, null, 5, { title: 'broken', url: null });
  const result = prepareWebsiteImport(flattenBookmarks([node]));
  assert.equal(result.cards.length, 1);
  assert.equal(result.invalid, 1);
});

test('unsafe URLs, relative URLs, browser internal pages and credentials are rejected', () => {
  const urls = ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///C:/test', 'edge://favorites', 'chrome://settings', 'https://user:pass@example.com', 'https://user@example.com', '/relative', '', '   ', null, {}];
  const result = prepareWebsiteImport(urls.map(url => ({ url })));
  assert.equal(result.invalid, urls.length);
  assert.deepEqual(result.cards, []);
});

test('normalization detects repeated URLs and preserves distinct fragments and titles', () => {
  const entries = [
    { url: 'https://EXAMPLE.com:443', title: 'First' },
    { url: 'https://example.com/', title: 'Renamed' },
    { url: 'https://example.com/#one', title: 'Same title' },
    { url: 'https://example.com/#two', title: 'Same title' },
    { url: 'https://another.example', title: 'Same title' }
  ];
  const before = structuredClone(entries);
  const result = prepareWebsiteImport(entries);
  assert.equal(result.cards.length, 4);
  assert.equal(result.duplicates, 1);
  assert.equal(result.cards[0].url, 'https://example.com/');
  assert.equal(result.cards[1].url, 'https://example.com/#one');
  assert.equal(result.cards[2].url, 'https://example.com/#two');
  assert.equal(result.cards[3].title, 'Same title');
  assert.deepEqual(entries, before);
  assert.equal(new Set(result.cards.map(card => card.id)).size, 4);
  for (const card of result.cards) {
    assert.match(card.id, /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i);
    assert.equal(card.type, 'website');
    assert.equal(card.icon, '');
    assert.equal(card.height, 220);
  }
});

test('existing website URLs dedupe; a feed URL can still become a website card', () => {
  const existing = [
    { type: 'website', url: 'https://EXAMPLE.com:443' },
    { type: 'website', url: 'broken' },
    { type: 'feed', url: 'https://example.org/feed' }
  ];
  const before = structuredClone(existing);
  const result = prepareWebsiteImport([{ url: 'https://example.com/' }, { url: 'https://example.org/feed' }], existing);
  assert.equal(result.duplicates, 1);
  assert.equal(result.cards.length, 1);
  assert.equal(result.cards[0].url, 'https://example.org/feed');
  assert.deepEqual(existing, before);
});

test('capacity counts all existing cards and over-capacity unique entries separately from duplicates', () => {
  const result = prepareWebsiteImport([
    { url: 'https://a.example' }, { url: 'https://b.example' }, { url: 'https://b.example/' },
    { url: 'https://c.example' }, { url: 'broken' }
  ], [{ type: 'note' }, { type: 'clock' }], 3);
  assert.equal(result.cards.length, 1);
  assert.equal(result.truncated, 2);
  assert.equal(result.duplicates, 1);
  assert.equal(result.invalid, 1);
  assert.equal(prepareWebsiteImport([{ url: 'https://a.example' }], [{ type: 'note' }], 0).truncated, 1);
});

test('default card limit is 200 and fallback titles use hostnames', () => {
  const result = prepareWebsiteImport(Array.from({ length: 201 }, (_, index) => ({ url: `https://example.com/${index}`, title: index === 0 ? '   ' : '名'.repeat(125) })));
  assert.equal(result.cards.length, 200);
  assert.equal(result.truncated, 1);
  assert.equal(result.cards[0].title, 'example.com');
  assert.equal(result.cards[1].title.length, 120);
  assert.deepEqual(prepareWebsiteImport(null), { cards: [], duplicates: 0, invalid: 0, truncated: 0 });
});
