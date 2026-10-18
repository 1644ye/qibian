import { defaults, validateState } from './core.js';
export function difference(base, next) {
  const patch = { settings: {}, cards: [], removed: [], order: null };
  for (const key of Object.keys(next.settings)) if (JSON.stringify(base.settings[key]) !== JSON.stringify(next.settings[key])) patch.settings[key] = next.settings[key];
  for (const card of next.cards) {
    const old = base.cards.find(c => c.id === card.id);
    if (!old) patch.cards.push({ id: card.id, create: card });
    else { const fields = {}; for (const key of Object.keys(card)) if (JSON.stringify(old[key]) !== JSON.stringify(card[key])) fields[key] = card[key]; if (Object.keys(fields).length) patch.cards.push({ id: card.id, fields }); }
  }
  patch.removed = base.cards.filter(c => !next.cards.some(n => n.id === c.id)).map(c => c.id);
  if (base.cards.map(c => c.id).join() !== next.cards.map(c => c.id).join()) patch.order = next.cards.map(c => c.id);
  return patch;
}
export function mergePatch(latest, patch) {
  const result = structuredClone(latest); Object.assign(result.settings, patch.settings);
  result.cards = result.cards.filter(c => !patch.removed.includes(c.id));
  for (const change of patch.cards) { const card = result.cards.find(c => c.id === change.id); if (card) Object.assign(card, change.fields || {}); else if (change.create) result.cards.push(change.create); }
  if (patch.order) result.cards.sort((a, b) => { const ai = patch.order.indexOf(a.id), bi = patch.order.indexOf(b.id); return (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi); });
  return validateState(result);
}
export async function writePatch(patch) {
  return navigator.locks.request('qibian-workspace', async () => {
    const stored = await chrome.storage.local.get(['workspace', 'syncConfig', 'syncOutbox', 'syncSequence']);
    const workspace = mergePatch(stored.workspace || defaults(), patch);
    const changes = { workspace };
    if (stored.syncConfig?.enabled) {
      changes.syncSequence = (stored.syncSequence || 0) + 1;
      changes.syncOutbox = [...(stored.syncOutbox || []), { seq:changes.syncSequence, patch }];
    }
    await chrome.storage.local.set(changes); return workspace;
  });
}
