'use strict';
(() => {
  function build(durationSeconds, mode, minutes) {
    if (!Number.isInteger(durationSeconds) || durationSeconds <= 0) {
      throw new RangeError('音频时长必须为正整数秒。');
    }
    if (mode !== 'single' && mode !== 'chunk') {
      throw new RangeError('请选择整段转录或自动分段。');
    }
    if (mode === 'chunk' && (!Number.isInteger(minutes) || minutes < 5 || minutes > 60)) {
      throw new RangeError('每段时长请输入 5–60 之间的整数分钟。');
    }
    const size = mode === 'single' ? durationSeconds : minutes * 60;
    return Array.from({ length: Math.ceil(durationSeconds / size) }, (_, index) => {
      const start = index * size;
      const end = Math.min(durationSeconds, start + size);
      return { index, start, end, duration: end - start };
    });
  }
  function formatTime(seconds) {
    return [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60]
      .map((value) => String(value).padStart(2, '0')).join(':');
  }
  function formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return remainder ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分钟`;
  }
  globalThis.TranscribeSegments = Object.freeze({ build, formatTime, formatDuration });
})();
