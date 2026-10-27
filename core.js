export const STORE_KEY = 'moments-v1';
export const MAX_RECORDS = 10000;
export const MAX_BACKUP_BYTES = 8 * 1024 * 1024;
export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function videoIdFromUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'www.youtube.com' || url.pathname !== '/watch') return null;
    const id = url.searchParams.get('v');
    return VIDEO_ID.test(id || '') ? id : null;
  } catch { return null; }
}
export function formatTime(value) {
  const seconds = Math.max(0, Math.floor(value));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor(seconds % 3600 / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return h ? h + ':' + String(m).padStart(2, '0') + ':' + s : m + ':' + s;
}
export function timestampUrl(record) {
  return 'https://www.youtube.com/watch?v=' + record.videoId + '&t=' + Math.floor(record.seconds) + 's';
}
function requireString(value, max, label, empty = false) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) throw new Error(label + '格式不正确。');
  return value;
}
export function validateRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('记录格式不正确。');
  if (typeof value.videoId !== 'string' || !VIDEO_ID.test(value.videoId)) throw new Error('视频 ID 格式不正确。');
  if (!Number.isInteger(value.seconds) || value.seconds < 0 || value.seconds > 31536000) throw new Error('时间戳格式不正确。');
  for (const key of ['createdAt', 'updatedAt']) {
    if (typeof value[key] !== 'string' || !Number.isFinite(Date.parse(value[key]))) throw new Error('记录日期格式不正确。');
  }
  return {
    id: requireString(value.id, 100, '记录 ID'),
    videoId: value.videoId,
    title: requireString(value.title, 300, '视频标题'),
    seconds: value.seconds,
    note: requireString(value.note, 5000, '备注', true),
    createdAt: new Date(value.createdAt).toISOString(),
    updatedAt: new Date(value.updatedAt).toISOString()
  };
}
export function createRecord(capture, now = new Date().toISOString(), id = crypto.randomUUID()) {
  return validateRecord({ ...capture, seconds: Math.floor(capture.seconds), note: '', id, createdAt: now, updatedAt: now });
}
export function parseBackup(text) {
  if (typeof text !== 'string') throw new Error('备份内容无效。');
  if (new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) throw new Error('备份文件不能超过 8 MB。');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('这不是有效的 JSON 文件。'); }
  if (!data || data.schemaVersion !== 1 || !Array.isArray(data.records)) throw new Error('请选择拾刻导出的 JSON 备份（版本 1）。');
  if (data.records.length > MAX_RECORDS) throw new Error('单个备份最多包含 10,000 条记录。');
  return data.records.map((r, index) => {
    try { return validateRecord(r); } catch (error) { throw new Error('第 ' + (index + 1) + ' 条记录：' + error.message); }
  });
}
export function mergeRecords(existing, incoming, newId = () => crypto.randomUUID()) {
  const records = existing.map(r => ({ ...r }));
  const ids = new Set(records.map(r => r.id));
  const fingerprint = r => JSON.stringify([r.videoId, r.seconds, r.note, r.createdAt]);
  const seen = new Set(records.map(fingerprint));
  let added = 0;
  for (const raw of incoming) {
    const record = validateRecord(raw);
    const key = fingerprint(record);
    if (seen.has(key)) continue;
    if (ids.has(record.id)) record.id = newId();
    ids.add(record.id);
    seen.add(key);
    records.push(record);
    added++;
  }
  if (records.length > MAX_RECORDS) throw new Error('记录数量超过 10,000 条，请先备份并清理部分记录。');
  return { records, added, skipped: incoming.length - added };
}
export function groupRecords(records, search = '', currentId = null) {
  const query = search.trim().toLocaleLowerCase();
  const groups = new Map();
  for (const r of records) {
    if (currentId && r.videoId !== currentId) continue;
    if (query && !(r.title + ' ' + r.note + ' ' + formatTime(r.seconds)).toLocaleLowerCase().includes(query)) continue;
    if (!groups.has(r.videoId)) groups.set(r.videoId, { videoId: r.videoId, title: r.title, latest: r.createdAt, records: [] });
    const group = groups.get(r.videoId);
    if (r.createdAt > group.latest) { group.latest = r.createdAt; group.title = r.title; }
    group.records.push(r);
  }
  return [...groups.values()].sort((a, b) => b.latest.localeCompare(a.latest)).map(g => ({
    ...g, records: g.records.sort((a, b) => a.seconds - b.seconds || a.createdAt.localeCompare(b.createdAt))
  }));
}
function escapeMarkdown(text) { return text.replace(/[\\`*_{}\[\]<>#|~]/g, '\\$&'); }
export function toMarkdown(records) {
  const lines = ['# 拾刻 · YouTube 时间戳', ''];
  for (const group of groupRecords(records)) {
    lines.push('## ' + escapeMarkdown(group.title.replace(/[\r\n]+/g, ' ')), '', '[打开视频](https://www.youtube.com/watch?v=' + group.videoId + ')', '');
    for (const r of group.records) lines.push('- [' + formatTime(r.seconds) + '](' + timestampUrl(r) + ')' + (r.note ? ' — ' + escapeMarkdown(r.note).replace(/\r?\n/g, '\n  ') : ''));
    lines.push('');
  }
  return lines.join('\n');
}
