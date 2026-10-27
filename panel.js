import { STORE_KEY, MAX_BACKUP_BYTES, formatTime, videoIdFromUrl, timestampUrl, groupRecords, toMarkdown, parseBackup } from './core.js';

const $ = id => document.getElementById(id);
let records = [];
let context = { videoId: null, title: '', status: null };
let windowId;
let mode = 'current';
let pageSize = 100;
let editing = null;
let toastTimer;
let undoRecord = null;
let contextRequest = 0;
let storeRequest = 0;
let recordBusy = false;
let nativeShortcut = '';
async function refreshShortcutSettings() {
  const value = await send({ type: 'GET_SHORTCUT' });
  $('single-key-enabled').checked = value.enabled;
  $('single-key').value = value.key;
  $('shortcut').textContent = value.enabled ? '按 ' + value.key : nativeShortcut || '快捷键未设置';
  updateShortcutHint();
}
function updateShortcutHint() {
  const key = $('single-key').value;
  const commonKeys = 'JKLMCFIT';
  $('shortcut-warning').textContent = commonKeys.includes(key)
    ? key + ' 与 YouTube 的常用操作冲突，启用后该键将用于记录。建议改用 B。'
    : '建议用 B。只在 YouTube 页面生效；输入搜索、评论或备注时不会触发。';
  $('single-key').disabled = !$('single-key-enabled').checked;
}
for (const key of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
  const option = document.createElement('option');
  option.value = key;
  option.textContent = key === 'B' ? 'B（推荐）' : key;
  $('single-key').append(option);
}
$('single-key').addEventListener('change', updateShortcutHint);
$('single-key-enabled').addEventListener('change', updateShortcutHint);
$('shortcut-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('save-shortcut').disabled = true;
  $('shortcut-feedback').hidden = true;
  try {
    const settings = { enabled: $('single-key-enabled').checked, key: $('single-key').value };
    await send({ type: 'SET_SHORTCUT', settings });
    await refreshShortcutSettings();
    $('shortcut-feedback').textContent = settings.enabled ? '已保存。回到视频页面，按 ' + settings.key + ' 即可记录。' : '已关闭页面单键记录。';
    $('shortcut-feedback').hidden = false;
  } catch (error) { showError(error); }
  finally { $('save-shortcut').disabled = false; }
});

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || '扩展未响应，请重新打开面板。');
  return response.data;
}
function showError(error) { $('error').textContent = error.message || String(error); $('error').hidden = false; }
function clearError() { $('error').hidden = true; }
function toast(text, undo = null) {
  clearTimeout(toastTimer);
  $('toast-text').textContent = text;
  undoRecord = undo;
  $('undo').hidden = !undo;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; undoRecord = null; }, undo ? 10000 : 4500);
}
function make(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
function dateLabel(iso) {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(new Date(iso));
}
function render() {
  $('count-current').textContent = records.filter(r => r.videoId === context.videoId).length;
  $('count-all').textContent = records.length;
  $('tab-current').setAttribute('aria-pressed', String(mode === 'current'));
  $('tab-all').setAttribute('aria-pressed', String(mode === 'all'));
  $('list-label').textContent = mode === 'current' ? '视频时间线 · 按播放时间排序' : '视频收藏 · 最近记录优先';
  const groups = mode === 'current' && !context.videoId ? [] : groupRecords(records, $('search').value, mode === 'current' ? context.videoId : null);
  const total = groups.reduce((sum, group) => sum + group.records.length, 0);
  $('result-count').textContent = total ? total + ' 个瞬间' : '';
  const fragment = document.createDocumentFragment();
  let displayed = 0;
  for (const group of groups) {
    if (displayed >= pageSize) break;
    if (mode === 'all') {
      const heading = make('section', 'video-group');
      heading.append(make('h2', '', group.title), make('p', '', group.records.length + ' 个瞬间'));
      fragment.append(heading);
    }
    for (const record of group.records) {
      if (displayed++ >= pageSize) break;
      const card = $('record-template').content.firstElementChild.cloneNode(true);
      card.dataset.id = record.id;
      card.querySelector('.time-button span').textContent = formatTime(record.seconds);
      card.querySelector('.time-button').setAttribute('aria-label', '跳转到 ' + formatTime(record.seconds));
      card.querySelector('.date').textContent = dateLabel(record.createdAt);
      card.querySelector('.date').title = new Date(record.createdAt).toLocaleString('zh-CN');
      card.querySelector('.note').textContent = record.note || '还没有备注，留个线索吧。';
      card.querySelector('.note').classList.toggle('no-note', !record.note);
      fragment.append(card);
    }
  }
  if (!total) {
    const empty = make('div', 'empty');
    let title = '第一刻，从这里开始';
    let detail = '看到值得回看的内容，点击「记下此刻」，让灵感有迹可循。';
    if ($('search').value.trim()) { title = '没有找到匹配的瞬间'; detail = '试试视频标题、备注关键词，或 12:35 这样的时间。'; }
    else if (mode === 'current' && !context.videoId) { title = '去看一段好视频'; detail = '打开 YouTube 普通视频即可开始记录。历史收藏在「全部记录」中。'; }
    else if (mode === 'all') { title = '你的收藏，从一刻开始'; detail = '记录会按视频自动整理。下次回来，点击时间就能继续回看。'; }
    empty.append(make('div', 'empty-symbol', '⌑'), make('h2', '', title), make('p', '', detail));
    fragment.append(empty);
  }
  $('records').replaceChildren(fragment);
  $('load-more').hidden = total <= pageSize;
}
function renderContext() {
  $('current-title').textContent = context.videoId ? context.title || 'YouTube 视频' : '收藏每个「原来如此」的瞬间';
  $('current-status').textContent = context.videoId ? context.status || '点击即刻保存位置，备注可以稍后补充。' : '打开 YouTube 普通视频，即可一键记录。';
  document.querySelector('.capture').classList.toggle('connected', !!context.videoId && !context.status);
  $('record').disabled = recordBusy || !context.videoId || !!context.status;
}
async function refreshContext() {
  const request = ++contextRequest;
  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    const id = videoIdFromUrl(tab?.url);
    let next = { videoId: id, title: tab?.title?.replace(/\s*-\s*YouTube$/, '') || '', status: null };
    if (id) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_CONTEXT' });
        if (response?.ok) next = response.data;
        else next.status = '播放器尚未就绪，请稍后再试。';
      } catch { next.status = '安装或更新后，请刷新这个 YouTube 页面。'; }
    }
    if (request !== contextRequest) return;
    const changed = JSON.stringify(next) !== JSON.stringify(context);
    context = next;
    renderContext();
    if (changed) render();
  } catch (error) { if (request === contextRequest) showError(error); }
}
async function refreshStore() {
  const request = ++storeRequest;
  const state = await send({ type: 'GET_STORE' });
  if (request !== storeRequest) return;
  records = state.records;
  render();
}
function edit(record, isNew = false) {
  editing = { ...record };
  $('edit-heading').textContent = isNew ? '已记下，为这一刻留个线索' : '这一刻的备注';
  $('edit-context').textContent = formatTime(record.seconds) + ' · ' + record.title;
  $('edit-note').value = record.note;
  $('note-count').textContent = record.note.length + ' / 5000';
  $('edit-error').hidden = true;
  $('edit-dialog').showModal();
  $('edit-note').focus();
}
function closeEditor() { $('edit-dialog').close(); editing = null; }
$('record').addEventListener('click', async () => {
  recordBusy = true; renderContext(); clearError();
  try {
    const saved = await send({ type: 'RECORD_ACTIVE', windowId });
    await refreshStore();
    edit(saved, true);
  } catch (error) { showError(error); }
  finally { recordBusy = false; renderContext(); }
});
for (const value of ['current', 'all']) $('tab-' + value).addEventListener('click', () => { mode = value; pageSize = 100; render(); });
$('search').addEventListener('input', () => { pageSize = 100; render(); });
$('load-more').addEventListener('click', () => { pageSize += 100; render(); });
$('records').addEventListener('click', async event => {
  const button = event.target.closest('button');
  const card = button?.closest('.moment');
  const record = records.find(r => r.id === card?.dataset.id);
  if (!record) return;
  clearError();
  try {
    if (button.classList.contains('edit')) { edit(record); return; }
    if (button.classList.contains('copy')) {
      await navigator.clipboard.writeText(timestampUrl(record));
      toast('已复制带时间戳的视频链接');
    } else if (button.classList.contains('time-button')) {
      button.disabled = true;
      const result = await send({ type: 'JUMP_RECORD', id: record.id, windowId });
      toast(result.opened ? '已在新标签页打开对应时间点' : result.paused ? '已定位，请点击视频播放' : '已跳转至 ' + formatTime(record.seconds));
    } else if (button.classList.contains('delete')) {
      button.disabled = true;
      const removed = await send({ type: 'DELETE_RECORD', id: record.id });
      await refreshStore();
      toast('已删除 ' + formatTime(record.seconds) + ' 的记录', removed);
    }
  } catch (error) { showError(error); }
  finally { button.disabled = false; }
});
$('undo').addEventListener('click', async () => {
  if (!undoRecord) return;
  $('undo').disabled = true;
  try {
    await send({ type: 'RESTORE_RECORD', record: undoRecord });
    await refreshStore();
    toast('记录已恢复');
  } catch (error) { showError(error); }
  finally { $('undo').disabled = false; }
});
$('edit-note').addEventListener('input', () => { $('note-count').textContent = $('edit-note').value.length + ' / 5000'; });
$('edit-close').addEventListener('click', closeEditor);
$('edit-cancel').addEventListener('click', closeEditor);
$('edit-dialog').addEventListener('cancel', () => { editing = null; });
$('edit-note').addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); if (!$('edit-save').disabled) $('edit-form').requestSubmit(); }
});
$('edit-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!editing) return;
  $('edit-save').disabled = true;
  try {
    await send({ type: 'UPDATE_NOTE', id: editing.id, note: $('edit-note').value, expectedUpdatedAt: editing.updatedAt });
    closeEditor();
    await refreshStore();
    toast('备注已保存');
  } catch (error) { $('edit-error').textContent = error.message; $('edit-error').hidden = false; }
  finally { $('edit-save').disabled = false; }
});
$('settings-toggle').addEventListener('click', () => {
  $('settings').hidden = !$('settings').hidden;
  $('settings-toggle').setAttribute('aria-expanded', String(!$('settings').hidden));
});
function download(content, filename, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = make('a');
  anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function localDate() {
  const now = new Date();
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
}
for (const kind of ['json', 'md']) $('export-' + kind).addEventListener('click', async () => {
  clearError();
  try {
    const state = await send({ type: 'GET_STORE' });
    const content = kind === 'json' ? JSON.stringify({ ...state, exportedAt: new Date().toISOString() }) : toMarkdown(state.records);
    download(content, '拾刻-' + localDate() + '.' + kind, kind === 'json' ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8');
    toast('已导出 ' + state.records.length + ' 条记录');
  } catch (error) { showError(error); }
});
$('import').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async () => {
  const file = $('import-file').files[0];
  if (!file) return;
  clearError(); $('import').disabled = true;
  try {
    if (file.size > MAX_BACKUP_BYTES) throw new Error('备份文件不能超过 8 MB。');
    const text = await file.text();
    parseBackup(text); // Validate the entire file before any storage write.
    const result = await send({ type: 'IMPORT_BACKUP', text });
    await refreshStore();
    mode = 'all'; $('search').value = ''; render();
    toast('已导入 ' + result.added + ' 条，跳过 ' + result.skipped + ' 条重复记录');
  } catch (error) { showError(error); }
  finally { $('import').disabled = false; $('import-file').value = ''; }
});
$('shortcut-settings').addEventListener('click', async event => {
  event.preventDefault();
  const isEdge = navigator.userAgent.includes('Edg/');
  try { await chrome.tabs.create({ url: isEdge ? 'edge://extensions/shortcuts' : 'chrome://extensions/shortcuts' }); }
  catch { toast('请在浏览器扩展管理页中打开「键盘快捷键」。'); }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[STORE_KEY]) refreshStore().catch(showError);
  if (changes['single-key-v1']) refreshShortcutSettings().catch(showError);
});
chrome.tabs.onActivated.addListener(info => { if (info.windowId === windowId) refreshContext(); });
chrome.tabs.onUpdated.addListener((_id, _change, tab) => { if (tab.active && tab.windowId === windowId) refreshContext(); });
async function init() {
  windowId = (await chrome.windows.getCurrent()).id;
  const commands = await chrome.commands.getAll();
  const shortcut = commands.find(c => c.name === 'record-moment')?.shortcut;
  nativeShortcut = shortcut;
  await Promise.all([refreshStore(), refreshContext(), refreshShortcutSettings()]);
  setInterval(refreshContext, 1600);
}
init().catch(showError);
