(() => {
  const defaults = { enabled: true, key: 'B' };
  function normalize(value) {
    if (!value || typeof value.enabled !== 'boolean' || typeof value.key !== 'string' || !/^[a-z]$/i.test(value.key)) throw new Error('请选择一个 A–Z 字母作为单键快捷键。');
    return { enabled: value.enabled, key: value.key.toUpperCase() };
  }
  function matches(event, settings, editable) {
    return settings.enabled && event.isTrusted && !editable && !event.isComposing && event.keyCode !== 229 &&
      !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey &&
      typeof event.key === 'string' && event.key.toUpperCase() === settings.key;
  }
  globalThis.MomentsShortcut = { defaults, normalize, matches };
})();
