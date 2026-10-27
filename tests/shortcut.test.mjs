import test from 'node:test';
import assert from 'node:assert/strict';
import '../shortcut.js';
const { defaults, normalize, matches } = globalThis.MomentsShortcut;
const event = { key: 'b', isTrusted: true };
test('默认 B，支持自定义字母与关闭', () => {
  assert.equal(matches(event,defaults,false),true);
  assert.equal(matches({...event,key:'B'},defaults,false),true);
  assert.deepEqual(normalize({enabled:true,key:'x'}),{enabled:true,key:'X'});
  assert.equal(matches(event,{enabled:false,key:'B'},false),false);
  assert.equal(matches(event,{enabled:true,key:'X'},false),false);
});
test('输入、组合键和输入法期间不触发', () => {
  assert.equal(matches(event,defaults,true),false);
  for (const key of ['ctrlKey','altKey','metaKey','shiftKey','isComposing']) assert.equal(matches({...event,[key]:true},defaults,false),false);
  assert.equal(matches({...event,keyCode:229},defaults,false),false);
});
test('网页脚本合成的按键不会保存记录', () => {
  assert.equal(matches({...event,isTrusted:false},defaults,false),false);
});
test('无效快捷键设置拒绝保存', () => {
  for (const key of ['', 'Space', 'Ctrl+B', '1', '中']) assert.throws(()=>normalize({enabled:true,key}));
  assert.throws(()=>normalize({enabled:'true',key:'B'}));
});
