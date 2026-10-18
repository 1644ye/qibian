export const fileIds = workspace => [...new Set((workspace?.cards || []).flatMap(card => [card.fileId, ...(card.tracks || []).map(track => track.fileId)]).filter(Boolean))];
export function remapPatch(patch, mapping = {}) {
  const id = value => mapping[value] || value;
  return { ...patch, cards: patch.cards.map(c => ({ ...c, id:id(c.id), ...(c.create ? { create:{ ...c.create, id:id(c.id) } } : {}) })), removed:patch.removed.map(id), order:patch.order?.map(id) };
}
