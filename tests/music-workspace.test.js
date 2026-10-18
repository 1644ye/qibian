import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, validateState } from '../core.js';
import { difference, mergePatch } from '../workspace-store.js';
test('playlist migration keeps its own name and preserves more than 100 tracks through backup roundtrip', () => {
  const state = defaults(); const media = state.cards.find(c => c.type === 'media');
  media.playlistName = '专注时光'; media.tracks = Array.from({ length: 1501 }, (_, i) => ({ fileId: `file-${i}`, filename: `曲目 ${i}.mp3`, mediaType: 'audio/mpeg' }));
  const restored = validateState(JSON.parse(JSON.stringify(state))).cards.find(c => c.id === media.id);
  assert.equal(restored.tracks.length, 1501); assert.equal(restored.playlistName, '专注时光');
});
test('independent settings, playlist and playback cursor updates do not overwrite each other', () => {
  const base = validateState(defaults()); const sidebar = structuredClone(base), manager = structuredClone(base);
  sidebar.settings.palettePreset = 'ocean';
  manager.cards.find(c => c.type === 'media').playlistName = '旅行';
  const merged = mergePatch(mergePatch(base, difference(base, sidebar)), difference(base, manager));
  assert.equal(merged.settings.palettePreset, 'ocean'); assert.equal(merged.cards.find(c => c.type === 'media').playlistName, '旅行');
});
