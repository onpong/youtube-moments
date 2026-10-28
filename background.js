import { STORE_KEY, MAX_BACKUP_BYTES, MAX_RECORDS, videoIdFromUrl, createRecord, validateRecord, parseBackup, mergeRecords, timestampUrl } from './core.js';

import './shortcut.js';
const SHORTCUT_KEY = 'single-key-v1';
async function getShortcut() {
  const value = (await chrome.storage.local.get(SHORTCUT_KEY))[SHORTCUT_KEY];
  return value ? MomentsShortcut.normalize(value) : { ...MomentsShortcut.defaults };
}
let writeQueue = Promise.resolve();
function mutate(change) {
  const operation = writeQueue.then(async () => {
    const state = await readStore();
    const result = change(state);
    if (state.records.length > MAX_RECORDS) throw new Error('记录已达 10,000 条，请先备份并清理。');
    if (new TextEncoder().encode(JSON.stringify(state)).length > MAX_BACKUP_BYTES - 1024) throw new Error('本地记录空间不足，请先导出备份并清理部分记录。');
    await chrome.storage.local.set({ [STORE_KEY]: state });
    return result;
  });
  writeQueue = operation.catch(() => {});
  return operation;
}
async function readStore() {
  const data = (await chrome.storage.local.get(STORE_KEY))[STORE_KEY];
  if (!data) return { schemaVersion: 1, records: [] };
  if (data.schemaVersion !== 1 || !Array.isArray(data.records)) throw new Error('本地数据版本无法读取，请保留扩展并联系维护者。');
  return { schemaVersion: 1, records: data.records.map(validateRecord) };
}
async function configure() {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}
chrome.runtime.onInstalled.addListener(() => { configure().catch(console.error); });
chrome.runtime.onStartup.addListener(() => { configure().catch(console.error); });

async function activeTab(windowId) {
  const [tab] = await chrome.tabs.query(Number.isInteger(windowId) ? { active: true, windowId } : { active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error('没有找到当前标签页。');
  return tab;
}
async function recordActive(windowId, showEditor) {
  const tab = await activeTab(windowId);
  if (!videoIdFromUrl(tab.url)) throw new Error('请先打开 YouTube 普通视频的观看页面。');
  let response;
  try { response = await chrome.tabs.sendMessage(tab.id, { type: 'RECORD_NOW', showEditor }); }
  catch { throw new Error('请刷新 YouTube 页面后重试，扩展尚未连接播放器。'); }
  if (!response?.ok) throw new Error(response?.error || '没有读取到播放器。');
  return response.data;
}
chrome.commands.onCommand.addListener(command => {
  if (command !== 'record-moment') return;
  recordActive(undefined, true).catch(async error => {
    try {
      const tab = await activeTab();
      await chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
      await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#b64832' });
      await chrome.action.setTitle({ tabId: tab.id, title: error.message });
      await chrome.tabs.sendMessage(tab.id, { type: 'SHOW_ERROR', message: error.message });
    } catch { /* The toolbar badge works even without a page script. */ }
  });
});
function requirePanel(sender) {
  if (!sender.url?.startsWith(chrome.runtime.getURL(''))) throw new Error('此操作只能在拾刻面板执行。');
}
async function handle(message, sender) {
  if (!message || typeof message.type !== 'string') throw new Error('请求无效。');
  if (message.type === 'GET_SHORTCUT') {
    if (!sender.url?.startsWith(chrome.runtime.getURL('')) &&
        !(sender.tab && sender.frameId === 0 && sender.url?.startsWith('https://www.youtube.com/'))) throw new Error('无法识别请求页面。');
    return getShortcut();
  }
  if (message.type === 'SAVE_CAPTURE') {
    if (!sender.tab || sender.frameId !== 0) throw new Error('无法识别视频标签页。');
    const tab = await chrome.tabs.get(sender.tab.id);
    if (videoIdFromUrl(tab.url) !== message.capture?.videoId) throw new Error('视频已切换，请重新记录。');
    const record = createRecord(message.capture);
    await mutate(state => { state.records.push(record); });
    await chrome.action.setBadgeText({ tabId: tab.id, text: '' }).catch(() => {});
    await chrome.action.setTitle({ tabId: tab.id, title: '打开拾刻' }).catch(() => {});
    return record;
  }
  if (message.type === 'UPDATE_NOTE') {
    if (typeof message.note !== 'string' || message.note.length > 5000) throw new Error('备注最多 5,000 字。');
    const fromPanel = sender.url?.startsWith(chrome.runtime.getURL(''));
    if (!fromPanel && sender.tab && !videoIdFromUrl(sender.url)) throw new Error('无法识别视频页面。');
    if (!sender.tab || fromPanel) requirePanel(sender);
    return mutate(state => {
      const record = state.records.find(r => r.id === message.id);
      if (!record) throw new Error('这条记录已被删除。');
      if (!fromPanel && sender.tab && record.videoId !== videoIdFromUrl(sender.url)) throw new Error('视频已切换，请在侧边栏修改备注。');
      if (message.expectedUpdatedAt && record.updatedAt !== message.expectedUpdatedAt) throw new Error('这条备注已在其他面板修改，请关闭编辑框后重新打开。');
      record.note = message.note.trim();
      record.updatedAt = new Date().toISOString();
      return record;
    });
  }
  requirePanel(sender);
  switch (message.type) {
    case 'SET_MASTERED': {
      if (typeof message.mastered !== 'boolean') throw new Error('攻克状态格式不正确。');
      return mutate(state => {
        const record = state.records.find(r => r.id === message.id);
        if (!record) throw new Error('这条记录已被删除。');
        record.mastered = message.mastered;
        record.updatedAt = new Date().toISOString();
        return record;
      });
    }
    case 'SET_SHORTCUT': {
      const settings = MomentsShortcut.normalize(message.settings);
      await chrome.storage.local.set({ [SHORTCUT_KEY]: settings });
      return settings;
    }
    case 'GET_STORE': await writeQueue; return readStore();
    case 'RECORD_ACTIVE': return recordActive(message.windowId, false);
    case 'DELETE_RECORD': return mutate(state => {
      const index = state.records.findIndex(r => r.id === message.id);
      if (index < 0) throw new Error('这条记录已被删除。');
      return state.records.splice(index, 1)[0];
    });
    case 'RESTORE_RECORD': return mutate(state => {
      const record = validateRecord(message.record);
      if (!state.records.some(r => r.id === record.id)) state.records.push(record);
      return record;
    });
    case 'IMPORT_BACKUP': {
      const incoming = parseBackup(message.text);
      return mutate(state => {
        const merged = mergeRecords(state.records, incoming);
        state.records = merged.records;
        return { added: merged.added, skipped: merged.skipped };
      });
    }
    case 'JUMP_RECORD': {
      await writeQueue;
      const state = await readStore();
      const record = state.records.find(r => r.id === message.id);
      if (!record) throw new Error('这条记录已被删除。');
      const tab = await activeTab(message.windowId);
      if (videoIdFromUrl(tab.url) === record.videoId) {
        let result;
        try { result = await chrome.tabs.sendMessage(tab.id, { type: 'SEEK', videoId: record.videoId, seconds: record.seconds }); }
        catch { throw new Error('请刷新 YouTube 页面后再跳转。'); }
        if (!result?.ok) throw new Error(result?.error || '跳转失败，请稍后重试。');
        return { opened: false, ...result.data };
      }
      await chrome.tabs.create({ url: timestampUrl(record), windowId: tab.windowId, active: true });
      return { opened: true };
    }
    default: throw new Error('未知操作。');
  }
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Keep this call within the original click's user activation.
  if (message?.type === 'OPEN_PANEL' && sender.tab && sender.frameId === 0 && videoIdFromUrl(sender.url)) {
    chrome.sidePanel.open({ windowId: sender.tab.windowId }).then(() => sendResponse({ ok: true })).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  handle(message, sender).then(data => sendResponse({ ok: true, data })).catch(error => {
    sendResponse({ ok: false, error: error.message || '操作失败，请重试。' });
  });
  return true;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[SHORTCUT_KEY]) return;
  chrome.tabs.query({ url: 'https://www.youtube.com/*' }).then(tabs =>
    Promise.allSettled(tabs.map(tab => chrome.tabs.sendMessage(tab.id, { type: 'SHORTCUT_CHANGED' })))
  ).catch(console.error);
});
