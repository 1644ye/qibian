(() => {
  if (window.top !== window || !/^https?:$/.test(location.protocol)) return;
  const hostId = 'qibian-mini-rail';
  const revision = '1.4.11';
  if (globalThis.__qibianRail?.host?.isConnected && globalThis.__qibianRail.revision === revision) return;
  try { globalThis.__qibianRail?.destroy(); } catch { /* Old extension contexts may already be invalidated after an update. */ }
  document.getElementById(hostId)?.remove();

  const host = document.createElement('div');
  host.id = hostId;
  host.style.cssText = 'all:initial!important;position:fixed!important;top:min(100px,15vh)!important;right:8px!important;width:44px!important;height:auto!important;max-height:calc(100vh - 120px)!important;z-index:2147483646!important;display:block!important;color-scheme:normal!important;';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host { --background:#f5f5ef; --surface:#fffefa; --text:#2a332d; --muted:#737c70; --line:#dce2d6; --accent:#547665; --onAccent:#ffffff; --radius:20px; }
    * { box-sizing:border-box; }
    .rail { width:44px; padding:4px; border:1px solid var(--line); border-radius:var(--radius); background:var(--background); color:var(--text); box-shadow:0 4px 18px color-mix(in srgb,var(--text) 14%,transparent); font:13px/1.4 system-ui,-apple-system,'Segoe UI','Microsoft YaHei',sans-serif; }
    button { appearance:none; display:flex; align-items:center; justify-content:center; width:34px; height:34px; flex:none; border:1px solid transparent; border-radius:var(--radius); background:var(--surface); color:var(--text); font:inherit; font-size:18px; cursor:pointer; padding:3px; overflow:hidden; transition:background .15s,border-color .15s; }
    button:hover { border-color:var(--accent); background:color-mix(in srgb,var(--surface) 86%,var(--accent)); }
    button:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }
    .expand { background:var(--accent); color:var(--onAccent); font-size:17px; font-weight:650; margin-bottom:5px; }
    .expand:hover { background:var(--accent); border-color:var(--onAccent); }
    .cards { display:flex; align-items:center; flex-direction:column; gap:5px; max-height:calc(100vh - 177px); overflow-y:auto; scrollbar-width:none; overscroll-behavior:contain; }
    .cards::-webkit-scrollbar { display:none; }
    .cards:empty { display:none; }
    .small { font-size:11px; line-height:1.1; overflow-wrap:anywhere; }
    img { display:block; width:24px; height:24px; object-fit:contain; border-radius:calc(var(--radius) / 2); }
    .status { position:absolute; top:0; right:52px; width:210px; padding:12px; border:1px solid var(--line); border-radius:var(--radius); color:var(--text); background:var(--surface); font:12px/1.6 system-ui,'Microsoft YaHei',sans-serif; box-shadow:0 4px 18px color-mix(in srgb,var(--text) 14%,transparent); }
    [hidden] { display:none!important; }
    .workspace-frame { display:block;width:100%;height:100%;border:1px solid var(--line);border-radius:14px;background:var(--background);box-shadow:0 8px 32px #0002; }
    .rail { border-radius:12px;box-shadow:0 2px 12px #0001; }
    button { border-radius:8px; }
    .frame-collapse { position:absolute;bottom:12px;right:12px;width:32px;height:32px;font-size:18px;border:1px solid var(--line);z-index:2; }
    button.playing { border-color:var(--accent);color:var(--accent);box-shadow:inset 0 -3px var(--accent); }
    .quick-frame { position:absolute;right:52px;top:0;width:min(380px,calc(100vw - 76px));height:min(560px,calc(100vh - 130px));border:1px solid var(--line);border-radius:12px;background:var(--background);box-shadow:0 8px 32px #0002; }

    @media (prefers-reduced-motion:reduce) { button { transition:none; } }
  `;
  const rail = document.createElement('nav');
  rail.className = 'rail';
  rail.setAttribute('aria-label', '栖边缩略模式');
  const expand = document.createElement('button');
  expand.type = 'button'; expand.className = 'expand'; expand.textContent = '栖';
  expand.title = '展开栖边'; expand.setAttribute('aria-label', '展开栖边');
  const cards = document.createElement('div'); cards.className = 'cards';
  const status = document.createElement('div'); status.className = 'status'; status.hidden = true; status.setAttribute('role', 'status');
  const collapse = document.createElement('button'); collapse.type = 'button'; collapse.className = 'frame-collapse'; collapse.textContent = '⇥'; collapse.title = '切换到小图标模式'; collapse.setAttribute('aria-label', '切换到小图标模式'); collapse.hidden = true;
  collapse.addEventListener('click', collapsePanel);
  rail.append(expand, cards);
  shadow.append(style, rail, status, collapse);
  document.documentElement.append(host);

  const defaultPalettes = {
    light: { background:'#f5f5ef', surface:'#fffefa', text:'#2a332d', muted:'#737c70', line:'#dce2d6', accent:'#547665', onAccent:'#ffffff' },
    dark: { background:'#1d2420', surface:'#252d27', text:'#e6ebdf', muted:'#a2ad9e', line:'#3b463d', accent:'#91b5a0', onAccent:'#14271b' }
  };
  const presetPalettes = {
    forest: defaultPalettes,
    ocean: { light:{ background:'#eef5f8',surface:'#ffffff',text:'#18313c',muted:'#607984',line:'#cbdde4',accent:'#277596',onAccent:'#ffffff' }, dark:{ background:'#101f27',surface:'#192d36',text:'#e2f0f5',muted:'#9bb4be',line:'#304a55',accent:'#62b6d4',onAccent:'#09242f' } },
    sunset: { light:{ background:'#fff5ed',surface:'#fffdf9',text:'#432d27',muted:'#836b62',line:'#ead8cd',accent:'#c35c39',onAccent:'#ffffff' }, dark:{ background:'#271914',surface:'#35221b',text:'#f5e6dc',muted:'#c6a89a',line:'#57382d',accent:'#f08b63',onAccent:'#2d140a' } },
    lavender: { light:{ background:'#f6f3fa',surface:'#fffdff',text:'#352d40',muted:'#746b80',line:'#dfd7e8',accent:'#755b9d',onAccent:'#ffffff' }, dark:{ background:'#211b29',surface:'#2d2537',text:'#eee8f5',muted:'#b5a7c3',line:'#493d57',accent:'#b69bd8',onAccent:'#1d102a' } },
    graphite: { light:{ background:'#f2f3f4',surface:'#ffffff',text:'#282b2e',muted:'#70767c',line:'#d9dcdf',accent:'#4d5963',onAccent:'#ffffff' }, dark:{ background:'#17191b',surface:'#232629',text:'#edf0f2',muted:'#a8afb5',line:'#3d4247',accent:'#b9c3ca',onAccent:'#182027' } }
  };
  const defaultCards = [{ id:'welcome', type:'note', title:'留一点空间给自己' }, { id:'clock', type:'clock', title:'此刻' }, { id:'media', type:'media', title:'我的播放器' }];
  const glyphs = { website:'↗', file:'▤', weather:'☀', feed:'≋', media:'▶', note:'✎', clock:'◷' };
  const colorQuery = matchMedia('(prefers-color-scheme: dark)');
  let workspace = {}, visible = true, statusTimer, frame, frameReady = false, pendingFocus = '', music = {}, quickFrame;
  let nativeOpen = false, surfaceRevision = 0, opening = false;
  const extensionOrigin = new URL(chrome.runtime.getURL('/')).origin;
  function updateVisibility() {
    const hidden = nativeOpen || !!document.fullscreenElement;
    host.style.setProperty('visibility', hidden ? 'hidden' : 'visible', 'important');
    host.style.setProperty('pointer-events', hidden ? 'none' : 'auto', 'important');
  }
  function applyTheme() {
    const settings = workspace.settings || {};
    const mode = settings.theme === 'dark' || settings.theme === 'system' && colorQuery.matches ? 'dark' : 'light';
    const preset = Object.hasOwn(presetPalettes, settings.palettePreset) ? settings.palettePreset : (settings.palettes ? 'custom' : 'graphite');
    const selected = preset === 'custom' ? settings.palettes?.[mode] : presetPalettes[preset][mode];
    for (const [key, fallback] of Object.entries(defaultPalettes[mode])) {
      const color = selected?.[key];
      host.style.setProperty('--' + key, /^#[\da-f]{6}$/i.test(color) ? color : fallback);
    }
    host.style.setProperty('--radius', Math.min(32, Math.max(0, settings.radius == null ? 20 : Number(settings.radius) || 0)) + 'px');
  }
  function showError(error) {
    status.textContent = error?.message || '操作失败，请刷新网页后重试。';
    status.hidden = false;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { status.hidden = true; }, 7000);
  }
  function collapsePanel(focus = true) {
    quickFrame?.remove(); quickFrame = null;
    // Keep the workspace document and its current contents alive while showing icons.
    if (frame) frame.hidden = true;
    rail.hidden = false; collapse.hidden = true; host.dataset.mode = 'mini'; updateVisibility();
    host.style.setProperty('width', '44px', 'important');
    host.style.setProperty('top', 'min(100px,15vh)', 'important');
    host.style.setProperty('height', 'auto', 'important');
    host.style.setProperty('max-height', 'calc(100vh - 120px)', 'important');
    if (focus) expand.focus();
  }
  function applyNativeState(open) {
    nativeOpen = open;
    if (open) { status.hidden = true; collapsePanel(false); }
    updateVisibility();
  }
  async function openPanel(cardId) {
    if (opening) return;
    opening = true;
    const revision = surfaceRevision;
    let timer;
    try {
      const state = await Promise.race([
        chrome.runtime.sendMessage({ type:'qibian:surface-state' }),
        new Promise(resolve => { timer = setTimeout(() => resolve({ nativeOpen }), 500); })
      ]);
      // A newer native-open/close or mini handoff takes priority over this reply.
      if (revision !== surfaceRevision) return;
      if (typeof state?.nativeOpen === 'boolean') applyNativeState(state.nativeOpen);
      if (nativeOpen) return;
      expandPanel(cardId);
    } catch(error) { if (revision === surfaceRevision && !nativeOpen) expandPanel(cardId); else showError(error); }
    finally { clearTimeout(timer); opening = false; }
  }
  function expandPanel(cardId) {
    quickFrame?.remove(); quickFrame = null;
    status.hidden = true; visible = true; updateVisibility(); pendingFocus = cardId || '';
    if (!frame) {
      frame = document.createElement('iframe'); frame.className = 'workspace-frame'; frame.title = '栖边';
      frame.src = chrome.runtime.getURL('sidepanel.html?embedded=1') + (cardId ? '&card=' + encodeURIComponent(cardId) : '');
      frame.allow = 'autoplay'; shadow.append(frame);
    } else {
      frame.hidden = false;
      frame.contentWindow.postMessage({ type:'qibian:set-display-mode', mode:'expanded' }, extensionOrigin);
      if (cardId) frame.contentWindow.postMessage({ type: 'qibian:focus', cardId }, extensionOrigin);
    }
    rail.hidden = true; collapse.hidden = frameReady; host.dataset.mode = 'expanded';
    host.style.setProperty('width', 'min(400px, calc(100vw - 16px))', 'important');
    host.style.setProperty('top', '8px', 'important');
    host.style.setProperty('height', 'calc(100vh - 16px)', 'important');
    host.style.setProperty('max-height', 'none', 'important');
  }
  function frameMessage(event) {
    if (quickFrame && event.source === quickFrame.contentWindow && event.origin === extensionOrigin) {
      if (event.data?.type === 'qibian:display-mode' && event.data.mode === 'mini') { quickFrame.remove(); quickFrame = null; }
      return;
    }
    if (!frame || event.source !== frame.contentWindow || event.origin !== extensionOrigin) return;
    if (event.data?.type === 'qibian:collapse-frame') collapsePanel();
    if (event.data?.type === 'qibian:display-mode' && event.data.mode === 'mini') collapsePanel();
    if (event.data?.type === 'qibian:frame-ready') { frameReady = true; collapse.hidden = true; }
    if (event.data?.type === 'qibian:frame-ready' && pendingFocus) frame.contentWindow.postMessage({ type: 'qibian:focus', cardId: pendingFocus }, extensionOrigin);
  }
  window.addEventListener('message', frameMessage);
  expand.addEventListener('click', () => openPanel());
  async function activateCard(card, button) {
    if (button.disabled) return;
    if (card.type === 'website' || card.type === 'media') {
      button.disabled = true;
      try {
        const result = await chrome.runtime.sendMessage({ type:'qibian:activate-card', cardId:card.id });
        if (!result || result.ok === false) throw new Error(result?.error || '未能执行此操作');
        if (card.type === 'media') { music = result; updateMusic(); }
      } catch(error) { showError(error); }
      finally { button.disabled = false; }
      return;
    }
    if (quickFrame?.dataset.cardId === card.id) { quickFrame.remove(); quickFrame = null; return; }
    quickFrame?.remove(); quickFrame = document.createElement('iframe'); quickFrame.className = 'quick-frame'; quickFrame.title = card.title; quickFrame.dataset.cardId = card.id;
    quickFrame.src = chrome.runtime.getURL('sidepanel.html?embedded=1&quick=1&card=' + encodeURIComponent(card.id)); shadow.append(quickFrame);
  }
  function render(value) {
    workspace = value && typeof value === 'object' ? value : {};
    applyTheme();
    const offset = cards.scrollTop;
    const focused = shadow.activeElement?.dataset.cardId;
    cards.replaceChildren();
    const items = Array.isArray(workspace.cards) ? workspace.cards : defaultCards;
    for (const card of items.slice(0, 200)) {
      if (!card || typeof card.id !== 'string' || !Object.hasOwn(glyphs, card.type)) continue;
      const button = document.createElement('button');
      button.type = 'button'; button.dataset.cardId = card.id; button.dataset.type = card.type;
      button.dataset.name = String(card.type === 'media' ? card.playlistName || card.title : card.title || '未命名卡片').slice(0,120);
      button.title = button.dataset.name;
      button.setAttribute('aria-label', '在栖边中打开：' + button.title);
      const icon = card.type === 'website' && typeof card.icon === 'string' ? card.icon : '';
      if (/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(icon) && icon.length <= 350000) {
        const img = document.createElement('img'); img.src = icon; img.alt = ''; button.append(img);
      } else {
        const validText = icon && icon.length <= 16 && !/[<>\x00-\x1f]/.test(icon) && !/^(data|https?|javascript):/i.test(icon);
        button.textContent = validText ? icon : glyphs[card.type];
        if (validText && [...icon].length > 2) button.classList.add('small');
      }
      button.addEventListener('click', () => activateCard(card, button));
      cards.append(button);
      if (focused === card.id) button.focus({ preventScroll:true });
    }
    cards.scrollTop = offset;
    updateMusic();
  }
  function updateMusic() {
    for (const node of cards.children) {
      const playing = node.dataset.cardId === music.cardId && !music.paused;
      node.classList.toggle('playing', playing);
      const label = node.dataset.type === 'media' ? `${playing ? '停止' : '播放'} ${node.dataset.name}` : `打开 ${node.dataset.name}`;
      node.title = label; node.setAttribute('aria-label', label);
      if (node.dataset.type === 'media') { node.textContent = playing ? '■' : '▶'; node.setAttribute('aria-pressed', String(playing)); }
    }
  }
  function storageChanged(changes, area) {
    if (area === 'local' && changes.workspace) render(changes.workspace.newValue);
    if (area === 'local' && changes.musicIndicator) { music = changes.musicIndicator.newValue || {}; updateMusic(); }
  }
  function messageReceived(message, sender, sendResponse) {
    if (message?.type === 'qibian:expand') { void openPanel(message.cardId); sendResponse({ ok:true }); }
    if (message?.type === 'qibian:mini') { surfaceRevision++; nativeOpen = false; collapsePanel(); sendResponse({ ok:true, mode:'mini', width:host.getBoundingClientRect().width }); }
    if (message?.type === 'qibian:rail-visibility') {
      visible = !!message.visible;
      // Legacy visibility-only messages can be stale; only the new native state
      // owns the surface, so they cannot strand the user with invisible icons.
      if (typeof message.nativeOpen === 'boolean') { surfaceRevision++; applyNativeState(message.nativeOpen); }
      sendResponse({ ok:true });
    }
  }
  chrome.storage.onChanged.addListener(storageChanged);
  chrome.runtime.onMessage.addListener(messageReceived);
  colorQuery.addEventListener('change', applyTheme);
  document.addEventListener('fullscreenchange', updateVisibility);
  globalThis.__qibianRail = { host, revision, collapse:collapsePanel, destroy() {
    clearTimeout(statusTimer);
    chrome.storage.onChanged.removeListener(storageChanged);
    chrome.runtime.onMessage.removeListener(messageReceived);
    colorQuery.removeEventListener('change', applyTheme);
    document.removeEventListener('fullscreenchange', updateVisibility);
    window.removeEventListener('message', frameMessage);
    host.remove();
  } };
  render(null);
  host.dataset.mode = 'mini';
  updateVisibility();
  chrome.storage.local.get('workspace').then(result => render(result.workspace)).catch(() => {});
  chrome.storage.local.get('musicIndicator').then(result => { music = result.musicIndicator || {}; updateMusic(); }).catch(() => {});
  chrome.runtime.sendMessage({ type:'qibian:rail-state' }).then(result => {
    if (result && surfaceRevision === 0 && typeof result.nativeOpen === 'boolean') applyNativeState(result.nativeOpen);
  }).catch(() => {});
})();
