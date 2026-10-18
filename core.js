export const kinds = { website: '网站', file: '文件', weather: '天气', feed: '信息流', media: '媒体', note: '便笺', clock: '时钟' };
export const paletteDefaults = () => ({
  light: { background: '#f5f5ef', surface: '#fffefa', text: '#2a332d', muted: '#737c70', line: '#dce2d6', accent: '#547665', onAccent: '#ffffff' },
  dark: { background: '#1d2420', surface: '#252d27', text: '#e6ebdf', muted: '#a2ad9e', line: '#3b463d', accent: '#91b5a0', onAccent: '#14271b' }
});
export const palettePresets = () => ({
  forest: { name: '森屿', ...paletteDefaults() },
  ocean: { name: '远海', light: { background: '#eef5f8', surface: '#ffffff', text: '#18313c', muted: '#607984', line: '#cbdde4', accent: '#277596', onAccent: '#ffffff' }, dark: { background: '#101f27', surface: '#192d36', text: '#e2f0f5', muted: '#9bb4be', line: '#304a55', accent: '#62b6d4', onAccent: '#09242f' } },
  sunset: { name: '晚霞', light: { background: '#fff5ed', surface: '#fffdf9', text: '#432d27', muted: '#836b62', line: '#ead8cd', accent: '#c35c39', onAccent: '#ffffff' }, dark: { background: '#271914', surface: '#35221b', text: '#f5e6dc', muted: '#c6a89a', line: '#57382d', accent: '#f08b63', onAccent: '#2d140a' } },
  lavender: { name: '雾紫', light: { background: '#f6f3fa', surface: '#fffdff', text: '#352d40', muted: '#746b80', line: '#dfd7e8', accent: '#755b9d', onAccent: '#ffffff' }, dark: { background: '#211b29', surface: '#2d2537', text: '#eee8f5', muted: '#b5a7c3', line: '#493d57', accent: '#b69bd8', onAccent: '#1d102a' } },
  graphite: { name: '石墨', light: { background: '#f2f3f4', surface: '#ffffff', text: '#282b2e', muted: '#70767c', line: '#d9dcdf', accent: '#4d5963', onAccent: '#ffffff' }, dark: { background: '#17191b', surface: '#232629', text: '#edf0f2', muted: '#a8afb5', line: '#3d4247', accent: '#b9c3ca', onAccent: '#182027' } }
});
export function resolvedPalette(settings, mode) {
  const presets = palettePresets();
  const preset = Object.hasOwn(presets, settings?.palettePreset) ? settings.palettePreset : 'forest';
  return settings?.palettePreset === 'custom' ? settings.palettes[mode] : presets[preset][mode];
}
export const defaults = () => ({
  version: 1,
  settings: { theme: 'light', palettePreset: 'graphite', palettes: paletteDefaults(), radius: 12, density: 'comfortable', columns: '1' },
  cards: [
    { id: 'welcome', type: 'note', title: '留一点空间给自己', text: '把常用的网站、随手的灵感和喜欢的声音，都放在这里。\n\n点击下方「添加内容」，开始布置你的侧边栏。', height: 220 },
    { id: 'clock', type: 'clock', title: '此刻', height: 190 },
    { id: 'media', type: 'media', title: '我的播放器', height: 220 }
  ]
});
export function safeURL(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('请输入有效的 http 或 https 地址，不含用户名和密码。');
  return url.href;
}
export function moveCard(cards, from, to) {
  const result = [...cards];
  if (from < 0 || to < 0 || from >= result.length || to >= result.length) return result;
  result.splice(to, 0, result.splice(from, 1)[0]);
  return result;
}
export function nextTrackIndex(length, current, mode, direction = 1, automatic = false, random = Math.random) {
  if (!Number.isInteger(length) || length <= 0) return -1;
  const index = Number.isInteger(current) && current >= 0 && current < length ? current : 0;
  if (automatic && mode === 'repeat-one') return index;
  if (mode === 'shuffle' && direction > 0) {
    if (length === 1) return 0;
    const offset = 1 + Math.floor(Math.max(0, Math.min(.999999, random())) * (length - 1));
    return (index + offset) % length;
  }
  const next = index + direction;
  if (next >= 0 && next < length) return next;
  if (mode === 'repeat-all') return (next + length) % length;
  return automatic ? -1 : index;
}
export function safeIcon(value) {
  if (!value) return '';
  if (typeof value !== 'string') throw new Error('网站图标格式无效。');
  if (/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(value) && value.length <= 350000) return value;
  if (value.length <= 16 && !/[<>\x00-\x1f]/.test(value) && !/^(data|https?|javascript):/i.test(value)) return value;
  throw new Error('图标请使用 16 字以内的文字或表情，或上传不超过 256 KB 的 PNG/JPEG/WebP/GIF。');
}
export function validateState(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.cards) || value.cards.length > 200) throw new Error('无效的配置文件。');
  const base = defaults();
  const s = value.settings || {};
  const palettes = paletteDefaults();
  for (const mode of ['light', 'dark']) for (const key of Object.keys(palettes[mode])) {
    const color = s.palettes?.[mode]?.[key];
    if (/^#[\da-f]{6}$/i.test(color)) palettes[mode][key] = color;
  }
  if (!s.palettes && /^#[\da-f]{6}$/i.test(s.accent)) palettes.light.accent = s.accent;
  base.settings = {
    theme: ['light', 'dark', 'system'].includes(s.theme) ? s.theme : 'light',
    palettePreset: ['forest', 'ocean', 'sunset', 'lavender', 'graphite', 'custom'].includes(s.palettePreset) ? s.palettePreset : (s.palettes || s.accent ? 'custom' : 'forest'),
    palettes,
    radius: s.radius == null ? 20 : Math.max(0, Math.min(32, Number(s.radius) || 0)),
    density: s.density === 'compact' ? 'compact' : 'comfortable', columns: s.columns === '2' ? '2' : '1'
  };
  const ids = new Set();
  base.cards = value.cards.map(c => {
    if (!c || !Object.hasOwn(kinds, c.type) || typeof c.id !== 'string' || !c.id || ids.has(c.id)) throw new Error('卡片格式有误或 ID 重复。');
    ids.add(c.id);
    const item = { id: c.id, type: c.type, title: String(c.title || kinds[c.type]).slice(0, 120), height: Math.max(160, Math.min(600, Number(c.height) || 220)) };
    if (['website', 'feed'].includes(c.type)) item.url = safeURL(c.url);
    if (c.type === 'website') { item.icon = safeIcon(c.icon); item.autoIcon = c.autoIcon === true; }
    if (c.type === 'note') item.text = String(c.text || '').slice(0, 30000);
    if (c.type === 'weather') {
      if (!Number.isFinite(c.latitude) || !Number.isFinite(c.longitude) || Math.abs(c.latitude) > 90 || Math.abs(c.longitude) > 180) throw new Error('天气坐标无效。');
      item.latitude = c.latitude; item.longitude = c.longitude; item.city = String(c.city || c.title).slice(0, 120);
    }
    if (c.type === 'file') { item.fileId = typeof c.fileId === 'string' ? c.fileId : ''; item.filename = String(c.filename || '').slice(0, 255); }
    if (c.type === 'media') {
      const source = Array.isArray(c.tracks) ? c.tracks : (c.fileId ? [{ fileId: c.fileId, filename: c.filename, mediaType: c.mediaType }] : []);
      item.tracks = source.flatMap(track => {
        if (!track || typeof track.fileId !== 'string' || !track.fileId) return [];
        return [{ fileId: track.fileId.slice(0, 200), filename: String(track.filename || '未命名音频').slice(0, 255), mediaType: /^(audio|video)\//.test(track.mediaType) ? track.mediaType.slice(0, 100) : '' }];
      });
      item.playlistName = String(c.playlistName || c.title || '我的歌单').slice(0, 120);
      item.playMode = ['order', 'repeat-all', 'repeat-one', 'shuffle'].includes(c.playMode) ? c.playMode : 'order';
      item.currentTrackId = item.tracks.some(track => track.fileId === c.currentTrackId) ? c.currentTrackId : (item.tracks[0]?.fileId || '');
    }
    return item;
  });
  return base;
}
export function weatherLabel(code) {
  if (code === 0) return ['☀', '晴'];
  if (code <= 3) return ['☁', '多云'];
  if (code <= 48) return ['≋', '雾'];
  if (code <= 67) return ['☂', '雨'];
  if (code <= 77 || code === 85 || code === 86) return ['❄', '雪'];
  if (code <= 82) return ['☂', '阵雨'];
  return ['ϟ', '雷雨'];
}
