import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecord, parseBackup, mergeRecords, groupRecords, formatTime, timestampUrl, videoIdFromUrl, toMarkdown } from '../core.js';

const base = { id: 'a', videoId: 'dQw4w9WgXcQ', title: '示例视频', seconds: 755, note: '核心原理', createdAt: '2026-10-27T00:00:00.000Z', updatedAt: '2026-10-27T00:00:00.000Z' };
test('只接受普通 YouTube 观看页面，同视频播放列表使用同一 ID', () => {
  assert.equal(videoIdFromUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=anything&t=20'), base.videoId);
  for (const url of ['https://evil.com/watch?v=dQw4w9WgXcQ','https://www.youtube.com/shorts/dQw4w9WgXcQ','https://www.youtube.com/watch?v=bad','javascript:alert(1)']) assert.equal(videoIdFromUrl(url), null);
});
test('秒数向下取整，支持零点和超过一小时', () => {
  assert.equal(createRecord({...base, seconds:755.99},base.createdAt,'new').seconds,755);
  assert.equal(formatTime(0),'0:00');
  assert.equal(formatTime(755),'12:35');
  assert.equal(formatTime(3723),'1:02:03');
  assert.equal(timestampUrl(base),'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=755s');
});
test('JSON 备份往返保留记录内容', () => {
  assert.deepEqual(parseBackup(JSON.stringify({schemaVersion:1,records:[base]})),[{...base,mastered:false}]);
});
test('旧记录默认未攻克，已攻克状态可备份且只接受布尔值', () => {
  const completed = {...base, mastered:true};
  assert.deepEqual(parseBackup(JSON.stringify({schemaVersion:1,records:[completed]})),[completed]);
  assert.equal(createRecord(completed).mastered,false);
  for (const mastered of [null, 'true', 1, {}]) {
    assert.throws(()=>parseBackup(JSON.stringify({schemaVersion:1,records:[{...base,mastered}]})));
  }
  assert.ok(toMarkdown([completed]).includes('- [x] [12:35]'));
  assert.ok(toMarkdown([base]).includes('- [ ] [12:35]'));
});
test('攻克状态冲突保留两版，旧备份重复导入不重复增项', () => {
  const completed = {...base,mastered:true};
  const merged = mergeRecords([completed],[base],()=> 'pending');
  assert.equal(merged.added,1);
  assert.equal(merged.records[0].mastered,true);
  assert.equal(merged.records[1].mastered,false);
  assert.equal(mergeRecords(merged.records,[base]).added,0);
  assert.equal(mergeRecords([base],[{...base,mastered:false}]).added,0);
});
test('非法备份整体拒绝，不容忍损坏记录', () => {
  for (const value of ['no json', '{"schemaVersion":2,"records":[]}', JSON.stringify({schemaVersion:1,records:[base,{...base,seconds:-1}]}),JSON.stringify({schemaVersion:1,records:[{...base,note:'x'.repeat(5001)}]}),JSON.stringify({schemaVersion:1,records:[{...base,createdAt:'no date'}]})]) assert.throws(()=>parseBackup(value));
});
test('重复导入幂等，冲突备注保留双方且不会重复增加', () => {
  assert.equal(mergeRecords([base],[base]).added,0);
  const conflicting = {...base,note:'另一个版本'};
  const merged = mergeRecords([base],[conflicting],()=> 'new');
  assert.equal(merged.added,1);
  assert.equal(merged.records[0].note,'核心原理');
  assert.equal(merged.records[1].id,'new');
  assert.equal(mergeRecords(merged.records,[conflicting]).added,0);
});
test('同一文件重复记录只导入一次', () => {
  const result = mergeRecords([], [base,base]);
  assert.equal(result.added,1);
  assert.equal(result.skipped,1);
});
test('按视频分组、按播放时间排序，搜索备注与时间', () => {
  const list = [base,{...base,id:'b',seconds:12},{...base,id:'c',videoId:'aaaaaaaaaaa',title:'第二个视频',createdAt:'2026-10-27T01:00:00.000Z'}];
  assert.equal(groupRecords(list)[0].videoId,'aaaaaaaaaaa');
  assert.deepEqual(groupRecords(list,'',base.videoId)[0].records.map(r=>r.seconds),[12,755]);
  assert.equal(groupRecords(list,'12:35').flatMap(g=>g.records).length,2);
  assert.equal(groupRecords(list,'核心').flatMap(g=>g.records).length,3);
  assert.equal(groupRecords(list,'不存在').length,0);
});
test('Markdown 导出包含时间链接并转义用户输入', () => {
  const md = toMarkdown([{...base,title:'[标题]<script>',note:'<img src=x>\\n[链接](evil)'}]);
  assert.ok(md.includes('[12:35]('+timestampUrl(base)+')'));
  assert.ok(md.includes('\\[标题\\]\\<script\\>'));
  assert.ok(md.includes('\\<img'));
});
