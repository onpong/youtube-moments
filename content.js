(() => {
  if (globalThis.__youtubeMomentsLoaded) return;
  globalThis.__youtubeMomentsLoaded = true;
  let navigating = false;
  let saving = false;
  let draftRecord = null;
  let errorTimer;
  let shortcut = { enabled: false, key: 'B' };
  let shortcutRequest = 0;
  async function refreshShortcut() {
    const request = ++shortcutRequest;
    const value = await send({ type: 'GET_SHORTCUT' });
    if (request !== shortcutRequest) return;
    shortcut = MomentsShortcut.normalize(value);
    $('record').title = shortcut.enabled ? '记录播放位置 · 按 ' + shortcut.key : '记录播放位置';
  }
  const host = document.createElement('div');
  host.id = 'youtube-moments';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host { all: initial; position: fixed; right: 22px; bottom: 22px; z-index: 2147483647; font: 14px/1.5 system-ui, "Microsoft YaHei", sans-serif; color: #172c28; color-scheme: light; }
      :host([hidden]) { display: none !important; }
      * { box-sizing: border-box; }
      button, input { font: inherit; }
      button { cursor: pointer; border: 0; }
      button:focus-visible, input:focus-visible { outline: 3px solid #8bd2b7; outline-offset: 3px; }
      .bar { display: flex; justify-content: flex-end; gap: 2px; filter: drop-shadow(0 5px 14px #0003); }
      .record, .open { background: #176b56; color: #fff; padding: 11px 17px; font-weight: 650; }
      .record { border-radius: 24px 0 0 24px; }
      .record:hover, .open:hover { background: #115341; }
      .record:disabled { opacity: .6; cursor: wait; }
      .open { border-radius: 0 24px 24px 0; padding: 11px 14px; }
      .card { width: min(310px, calc(100vw - 44px)); background: #fffefb; padding: 16px; border: 1px solid #dfebe5; border-radius: 16px; margin-bottom: 10px; box-shadow: 0 8px 35px #0002; }
      [hidden] { display: none !important; }
      .heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
      strong { font-size: 14px; color: #176b56; }
      .close { background: transparent; color: #697b74; padding: 2px 7px; font-size: 20px; }
      input { width: 100%; border: 1px solid #dce4df; background: #fff; color: #172c28; padding: 9px; border-radius: 8px; }
      .save { display: block; margin: 10px 0 0 auto; padding: 7px 13px; border-radius: 8px; color: #176b56; background: #e6f2ec; }
      .hint { color: #6d7e76; margin: 9px 0 0; font-size: 11px; }
      .error { background: #fff5ef; color: #903a29; font-size: 13px; }
    </style>
    <div id="error" class="card error" role="status" hidden></div>
    <form id="editor" class="card" hidden>
      <div class="heading"><strong id="saved"></strong><button class="close" id="close" type="button" aria-label="关闭备注输入">×</button></div>
      <input id="note" aria-label="为时间戳添加备注" placeholder="这一刻，值得记住什么？（可选）" maxlength="5000" autocomplete="off">
      <button class="save" id="save" type="submit">保存备注</button>
      <p class="hint">时间戳已保存。备注也可以稍后在侧边栏补充。</p>
    </form>
    <div class="bar">
      <button class="record" id="record" type="button" title="记录播放位置 · Alt+Shift+S">＋ 记下此刻</button>
      <button class="open" id="open" type="button" aria-label="打开拾刻侧边栏" title="打开全部记录">☰</button>
    </div>
  `;
  const $ = id => root.getElementById(id);

  function videoId() {
    const url = new URL(location.href);
    const id = url.searchParams.get('v');
    return url.pathname === '/watch' && /^[A-Za-z0-9_-]{11}$/.test(id || '') ? id : null;
  }
  function syncHost() {
    const parent = document.fullscreenElement || document.documentElement;
    if (host.parentElement !== parent) parent.appendChild(host);
    host.hidden = !videoId();
  }
  function errorText(error) {
    return /Extension context invalidated|Receiving end does not exist/.test(error?.message || '') ? '扩展已更新，请刷新 YouTube 页面后重试。' : error.message || '操作失败，请重试。';
  }
  function showError(error) {
    clearTimeout(errorTimer);
    $('error').textContent = typeof error === 'string' ? error : errorText(error);
    $('error').hidden = false;
    errorTimer = setTimeout(() => { $('error').hidden = true; }, 6500);
  }
  async function send(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || '扩展未响应，请刷新页面。');
    return response.data;
  }
  function playerState() {
    const id = videoId();
    if (!id || navigating) throw new Error('视频正在切换，请等待播放器就绪。');
    const watch = document.querySelector('ytd-watch-flexy');
    const domId = watch?.getAttribute('video-id');
    if (domId && domId !== id) throw new Error('视频正在切换，请稍后再记录。');
    const player = document.getElementById('movie_player');
    if (player?.classList.contains('ad-showing') || player?.classList.contains('ad-interrupting')) throw new Error('正在播放广告，请在正片开始后操作。');
    const video = player?.querySelector('video.html5-main-video') || document.querySelector('video.html5-main-video');
    if (!video || video.readyState < 1 || !Number.isFinite(video.currentTime) || !video.duration) throw new Error('播放器尚未就绪，请开始播放后再试。');
    const liveBadge = player?.querySelector('.ytp-live-badge');
    const liveVisible = liveBadge && liveBadge.getClientRects().length > 0 && getComputedStyle(liveBadge).visibility !== 'hidden';
    if (!Number.isFinite(video.duration) || liveVisible) throw new Error('第一版仅支持普通点播视频，暂不记录直播。');
    return { id, video };
  }
  function capture() {
    const { id, video } = playerState();
    const heading = document.querySelector('ytd-watch-metadata h1 yt-formatted-string, #title h1 yt-formatted-string, h1.title yt-formatted-string');
    const title = (heading?.textContent || document.title.replace(/\s*-\s*YouTube$/, '') || 'YouTube 视频').trim().slice(0, 300);
    return { videoId: id, title: title || 'YouTube 视频', seconds: Math.floor(video.currentTime) };
  }
  function time(seconds) {
    const h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = String(seconds % 60).padStart(2, '0');
    return h ? h + ':' + String(m).padStart(2, '0') + ':' + s : m + ':' + s;
  }
  async function record(showEditor = true) {
    if (saving) throw new Error('上一条正在保存，请稍后。');
    // Read currentTime before any await, so typing or disk writes cannot shift the timestamp.
    const snapshot = capture();
    saving = true;
    $('record').disabled = true;
    try {
      const saved = await send({ type: 'SAVE_CAPTURE', capture: snapshot });
      if (showEditor) {
        // Preserve an unfinished note instead of silently replacing it.
        if (draftRecord && !$('editor').hidden && $('note').value.trim()) {
          showError('新时间戳已保存至 ' + time(saved.seconds) + '。当前未保存的备注已保留。');
        } else {
          draftRecord = saved;
          $('saved').textContent = '✓ 已记下 ' + time(saved.seconds);
          $('note').value = '';
          $('editor').hidden = false;
        }
      }
      return saved;
    } finally { saving = false; $('record').disabled = false; }
  }
  $('record').addEventListener('click', () => record().catch(showError));
  $('open').addEventListener('click', () => send({ type: 'OPEN_PANEL' }).catch(() => showError('请点击浏览器工具栏上的拾刻图标打开侧边栏。')));
  $('close').addEventListener('click', () => { $('editor').hidden = true; draftRecord = null; });
  $('editor').addEventListener('submit', async event => {
    event.preventDefault();
    if (!draftRecord) return;
    $('save').disabled = true;
    try {
      await send({ type: 'UPDATE_NOTE', id: draftRecord.id, note: $('note').value, expectedUpdatedAt: draftRecord.updatedAt });
      $('editor').hidden = true;
      draftRecord = null;
    } catch (error) { showError(error); }
    finally { $('save').disabled = false; }
  });
  for (const type of ['keydown', 'keyup', 'keypress']) $('editor').addEventListener(type, event => event.stopPropagation());

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message.type === 'SHORTCUT_CHANGED') {
      refreshShortcut().catch(() => {});
      respond({ ok: true });
      return false;
    }
    if (message.type === 'GET_CONTEXT') {
      let status = null;
      try { capture(); } catch (error) { status = error.message; }
      respond({ ok: true, data: { videoId: videoId(), title: document.title.replace(/\s*-\s*YouTube$/, ''), status } });
      return false;
    }
    if (message.type === 'SHOW_ERROR') { showError(message.message); respond({ ok: true }); return false; }
    if (message.type === 'RECORD_NOW') {
      record(message.showEditor).then(data => respond({ ok: true, data })).catch(error => { showError(error); respond({ ok: false, error: errorText(error) }); });
      return true;
    }
    if (message.type === 'SEEK') {
      (async () => {
        const { id, video } = playerState();
        if (id !== message.videoId) throw new Error('当前视频已经切换，请重新点击记录。');
        if (!Number.isInteger(message.seconds) || message.seconds < 0 || message.seconds > video.duration) throw new Error('时间戳超出当前视频长度，视频可能已被剪辑。');
        video.currentTime = message.seconds;
        let paused = false;
        try { await video.play(); } catch { paused = true; }
        return { paused };
      })().then(data => respond({ ok: true, data })).catch(error => respond({ ok: false, error: errorText(error) }));
      return true;
    }
    return false;
  });
  window.addEventListener('keydown', event => {
    if (!videoId()) return;
    const editable = document.designMode === 'on' || event.composedPath().some(node =>
      node instanceof Element && (node.isContentEditable ||
        node.matches('input, textarea, select, [role="textbox"], [role="searchbox"], [role="combobox"]'))
    );
    if (!MomentsShortcut.matches(event, shortcut, editable)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat && !saving) record().catch(showError);
  }, true);
  window.addEventListener('focus', () => refreshShortcut().catch(() => {}));
  refreshShortcut().catch(() => {});
  document.addEventListener('yt-navigate-start', () => { navigating = true; });
  document.addEventListener('yt-navigate-finish', () => { navigating = false; syncHost(); });
  document.addEventListener('fullscreenchange', syncHost);
  window.addEventListener('popstate', syncHost);
  syncHost();
  // A cheap fallback covers History API changes without YouTube's navigation events.
  setInterval(syncHost, 1500);
})();
