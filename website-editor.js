import { safeURL } from './core.js';

function webURL(value, base) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try { return safeURL(base ? new URL(value, base).href : value); } catch { return ''; }
}
async function limitedFetch(url, signal, limit) {
  const response = await fetch(url, { signal, credentials:'omit', referrerPolicy:'no-referrer' });
  if (!response.ok) throw new Error('读取失败');
  const reader = response.body.getReader(), parts = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > limit) throw new Error('内容过大'); parts.push(value); }
  } finally { await reader.cancel().catch(() => {}); }
  return { blob:new Blob(parts, { type:response.headers.get('content-type') || '' }), url:response.url };
}
async function iconData(url, signal) {
  const { blob } = await limitedFetch(url, signal, 1024 * 1024);
  const objectURL = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      const fail = () => reject(new Error('图标不可用'));
      image.onload = resolve; image.onerror = fail;
      signal.addEventListener('abort', fail, { once:true });
      if (signal.aborted) fail(); else image.src = objectURL;
    });
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('图标不可用');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
    const ratio = Math.min(64 / image.naturalWidth, 64 / image.naturalHeight);
    const width = image.naturalWidth * ratio, height = image.naturalHeight * ratio;
    canvas.getContext('2d').drawImage(image, (64 - width) / 2, (64 - height) / 2, width, height);
    return canvas.toDataURL('image/png');
  } finally { URL.revokeObjectURL(objectURL); }
}
async function currentWebsite() {
  const own = await chrome.tabs.getCurrent();
  const active = (await chrome.tabs.query({ active:true, currentWindow:true }))[0];
  let tab = own && webURL(own.url) ? own : active;
  if (!webURL(tab?.url)) tab = (await chrome.tabs.query({ currentWindow:true })).filter(t => webURL(t.url)).sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  if (!tab) throw new Error('请先打开要添加的普通网页，或直接填写网址。');
  let info = { url:tab.url, title:tab.title, icon:tab.favIconUrl };
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target:{ tabId:tab.id }, func:() => ({ url:location.href, title:document.title, icon:document.querySelector('link[rel~="icon"],link[rel="apple-touch-icon"]')?.href }) });
    if (result) info = { ...info, ...result, icon:result.icon || info.icon };
  } catch { /* The tab metadata remains usable when this site blocks script injection. */ }
  return info;
}

export function mountWebsiteEditor(fields, card) {
  const url = fields.querySelector('[name="url"]'), title = fields.querySelector('[name="title"]');
  const textIcon = fields.querySelector('[name="icon"]'), upload = fields.querySelector('[name="iconFile"]');
  const reset = fields.querySelector('[name="resetIcon"]');
  const controls = document.createElement('div'); controls.className = 'button-row';
  const current = document.createElement('button'); current.type = 'button'; current.className = 'secondary'; current.textContent = '读取当前网页';
  const refresh = document.createElement('button'); refresh.type = 'button'; refresh.className = 'secondary'; refresh.textContent = '自动读取图标';
  const preview = document.createElement('span'); preview.className = 'site-icon'; preview.setAttribute('aria-label', '网站图标预览');
  const status = document.createElement('p'); status.className = 'muted website-read-status'; status.setAttribute('role', 'status');
  controls.append(current, refresh, preview); url.closest('label').after(controls, status);
  let controller, timer, job = Promise.resolve(), disposed = false, revision = 0, autoTitle = '', automaticIcon = card?.autoIcon ? card.icon : '', iconURL = card?.autoIcon ? card.url : '', preferAutomatic = false;
  const custom = () => Boolean(textIcon.value.trim() || upload.files?.length || card?.icon && !card.autoIcon && !preferAutomatic && !reset?.checked);
  function showIcon(value) {
    preview.replaceChildren();
    if (value?.startsWith('data:image/')) { const image = document.createElement('img'); image.src = value; image.alt = ''; preview.append(image); }
    else preview.textContent = value || '↗';
  }
  function setTitle(value) { if (!title.value || title.value === autoTitle) { autoTitle = String(value || '').trim().slice(0, 120); title.value = autoTitle; } }
  async function read(info) {
    clearTimeout(timer); timer = null; controller?.abort(); controller = new AbortController();
    const signal = controller.signal, version = ++revision, address = webURL(url.value);
    automaticIcon = ''; iconURL = '';
    if (!address || disposed) return;
    setTitle(new URL(address).hostname);
    status.textContent = '正在读取网站信息…';
    const deadline = setTimeout(() => controller?.signal === signal && controller.abort(), 6000);
    try {
      let candidates = [];
      if (info) { setTitle(info.title); if (webURL(info.icon, address)) candidates.push(webURL(info.icon, address)); }
      else {
        try {
          const fetched = await limitedFetch(address, signal, 1024 * 1024);
          const html = new DOMParser().parseFromString(await fetched.blob.text(), 'text/html');
          if (version !== revision || disposed) return;
          setTitle(html.querySelector('title')?.textContent || new URL(address).hostname);
          const base = webURL(html.querySelector('base[href]')?.getAttribute('href'), fetched.url) || fetched.url;
          candidates = [...html.querySelectorAll('link[rel~="icon"],link[rel="apple-touch-icon"]')].map(link => webURL(link.getAttribute('href'), base)).filter(Boolean).slice(0, 3);
        } catch { /* An unavailable title must not prevent favicon fallback or saving the URL. */ }
      }
      candidates.push(new URL('/favicon.ico', address).href);
      for (const candidate of [...new Set(candidates)]) {
        if (signal.aborted) break;
        try {
          const data = await iconData(candidate, signal);
          if (version !== revision || disposed || webURL(url.value) !== address) return;
          automaticIcon = data; iconURL = address; break;
        } catch { /* Try the site's next declared icon. */ }
      }
      if (version !== revision || disposed) return;
      if (!custom()) showIcon(automaticIcon);
      status.textContent = automaticIcon ? (custom() ? '已读取网站图标；保存时优先使用你的自定义图标。' : '已读取网站图标，保存后可离线显示。') : '未能读取网站图标，可上传图片或使用文字图标；网址仍可保存。';
    } finally { clearTimeout(deadline); }
  }
  function start(info) { job = read(info).catch(() => { if (!disposed) status.textContent = '暂时无法读取，可手动填写或上传图标。'; }); return job; }
  async function fromCurrent(automatic = false) {
    const original = url.value, version = revision;
    current.disabled = true;
    try {
      const info = await currentWebsite();
      if (disposed || revision !== version || automatic && url.value !== original) return;
      url.value = safeURL(info.url); setTitle(info.title); await start(info);
    } catch (error) { if (!disposed) status.textContent = error.message; }
    finally { current.disabled = false; }
  }
  url.addEventListener('input', () => {
    controller?.abort(); revision++; automaticIcon = ''; iconURL = ''; clearTimeout(timer);
    status.textContent = webURL(url.value) ? '正在读取网站信息…' : '请填写完整的 http 或 https 网址。';
    if (!custom()) showIcon('');
    if (webURL(url.value)) { setTitle(new URL(url.value).hostname); timer = setTimeout(() => void start(), 450); }
  });
  url.addEventListener('change', () => { if (webURL(url.value)) { url.value = safeURL(url.value); if (timer) void start(); } });
  current.addEventListener('click', () => { job = fromCurrent(); });
  refresh.addEventListener('click', () => { preferAutomatic = true; textIcon.value = ''; upload.value = ''; if (reset) reset.checked = false; void start(); });
  textIcon.addEventListener('input', () => showIcon(textIcon.value.trim() || automaticIcon || card?.icon));
  upload.addEventListener('change', () => {
    if (!upload.files[0]) return;
    const reader = new FileReader(); reader.onload = () => { if (!disposed) showIcon(reader.result); }; reader.readAsDataURL(upload.files[0]);
    status.textContent = '已选择自定义图标，保存时优先使用上传图片。';
  });
  showIcon(card?.icon);
  if (!card && globalThis.chrome?.tabs) job = fromCurrent(true);
  else if (card && !card.icon) void start();
  return {
    async icon(address) { if (timer && webURL(url.value)) await start(); else await job; return iconURL === address ? automaticIcon : ''; },
    get preferAutomatic() { return preferAutomatic; },
    dispose() { disposed = true; revision++; clearTimeout(timer); timer = null; controller?.abort(); }
  };
}
