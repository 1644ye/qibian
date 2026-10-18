import test from 'node:test';
import assert from 'node:assert/strict';
import { safeURL, safeIcon, defaults, validateState, moveCard, nextTrackIndex, weatherLabel, palettePresets, resolvedPalette } from '../core.js';

test('URLs reject executable schemes and credentials', () => {
  for (const url of ['javascript:alert(1)', 'file:///C:/secret', 'data:text/html,hello', 'https://name:password@example.com', 'not-a-url']) assert.throws(() => safeURL(url));
  assert.equal(safeURL('https://example.com'), 'https://example.com/');
});
test('reordering preserves every card without mutating original', () => {
  const cards = ['a', 'b', 'c'];
  assert.deepEqual(moveCard(cards, 0, 2), ['b', 'c', 'a']);
  assert.deepEqual(cards, ['a', 'b', 'c']);
  assert.deepEqual(moveCard(cards, 0, -1), cards);
  assert.deepEqual(moveCard(cards, 2, 3), cards);
});
test('backup validation rejects broken cards, duplicates and invalid coordinates', () => {
  const s = defaults();
  assert.throws(() => validateState({ ...s, cards: [s.cards[0], s.cards[0]] }));
  assert.throws(() => validateState({ ...s, cards: [{ id: 'x', type: 'weather', latitude: 91, longitude: 0 }] }));
  assert.throws(() => validateState({ ...s, cards: [{ id: 'x', type: 'website', url: 'javascript:alert(1)' }] }));
  assert.throws(() => validateState({ version: 2, cards: [] }));
  assert.throws(() => validateState({ ...s, cards: [{ id: 'x', type: 'toString' }] }));
});
test('backups roundtrip all supported cards and normalize appearance', () => {
  const state = defaults();
  state.cards.push({ id: 'web', type: 'website', title: 'example', url: 'https://example.com/', embed: true, color: 'plain', height: 220 }, { id: 'weather', type: 'weather', title: '上海', city: '上海', latitude: 31.23, longitude: 121.47, height: 220, color: 'sand' }, { id: 'file', type: 'file', title: '文档', fileId: 'blob', filename: 'note.txt', height: 220, color: 'plain' }, { id: 'feed', type: 'feed', title: 'RSS', url: 'https://example.com/feed', height: 220, color: 'plain' });
  const normalized = validateState(state);
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(normalized))), normalized);
  const invalidSettings = validateState({ ...state, settings: { radius: 999, accent: 'red;display:none', columns: '9' } });
  assert.equal(invalidSettings.settings.radius, 32);
  assert.equal(invalidSettings.settings.palettes.light.accent, '#547665');
  assert.equal(invalidSettings.settings.columns, '1');
});
test('legacy palettes migrate globally and unsafe icons are rejected', () => {
  const state = validateState({ version: 1, settings: { accent: '#123456', radius: 0 }, cards: [{ id: 'x', title: '网站', type: 'website', url: 'https://example.com', color: 'rose', embed: true, icon: '🌲' }] });
  assert.equal(state.settings.palettes.light.accent, '#123456');
  assert.equal(state.settings.palettePreset, 'custom');
  assert.equal(state.settings.radius, 0);
  assert.equal(state.cards[0].color, undefined);
  assert.equal(state.cards[0].icon, '🌲');
  assert.equal(safeIcon('data:image/png;base64,aGVsbG8='), 'data:image/png;base64,aGVsbG8=');
  for (const icon of ['javascript:1', 'https://x.io/a', 'data:image/svg+xml,<svg/>', '<script>', 'a'.repeat(17)]) assert.throws(() => safeIcon(icon));
});
test('multiple color presets resolve independently for light and dark themes', () => {
  const presets = palettePresets();
  assert.deepEqual(Object.keys(presets), ['forest', 'ocean', 'sunset', 'lavender', 'graphite']);
  const state = validateState({ ...defaults(), settings: { ...defaults().settings, palettePreset: 'ocean' } });
  assert.equal(resolvedPalette(state.settings, 'light').accent, '#277596');
  assert.equal(resolvedPalette(state.settings, 'dark').accent, '#62b6d4');
  assert.notDeepEqual(resolvedPalette(state.settings, 'light'), resolvedPalette({ ...state.settings, palettePreset: 'sunset' }, 'light'));
});
test('legacy single media migrates to a playlist and playback order is validated', () => {
  const state = validateState({ ...defaults(), cards: [{ id: 'music', type: 'media', title: '歌单', fileId: 'old-file', filename: '旧歌曲.mp3', mediaType: 'audio/mpeg', playMode: 'bad' }] });
  assert.deepEqual(state.cards[0].tracks, [{ fileId: 'old-file', filename: '旧歌曲.mp3', mediaType: 'audio/mpeg' }]);
  assert.equal(state.cards[0].currentTrackId, 'old-file');
  assert.equal(state.cards[0].playMode, 'order');
});
test('playlist order supports sequential, looping, repeat-one and shuffle', () => {
  assert.equal(nextTrackIndex(3, 0, 'order', 1, true), 1);
  assert.equal(nextTrackIndex(3, 2, 'order', 1, true), -1);
  assert.equal(nextTrackIndex(3, 2, 'repeat-all', 1, true), 0);
  assert.equal(nextTrackIndex(3, 1, 'repeat-one', 1, true), 1);
  assert.equal(nextTrackIndex(3, 0, 'shuffle', 1, true, () => 0), 1);
  assert.equal(nextTrackIndex(3, 0, 'shuffle', 1, true, () => .99), 2);
  assert.equal(nextTrackIndex(3, 2, 'order', 1, false), 2);
});
test('weather codes cover snow showers and thunderstorms', () => {
  assert.equal(weatherLabel(85)[1], '雪');
  assert.equal(weatherLabel(95)[1], '雷雨');
});
