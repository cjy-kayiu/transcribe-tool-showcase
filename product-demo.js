'use strict';
(() => {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const sample = globalThis.TRANSCRIBE_SAMPLE;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wave = $('#hero-wave');
  for (let index = 0; index < 64; index++) {
    const bar = document.createElement('i');
    bar.style.height = `${8 + Math.abs(Math.sin(index * 1.37) * Math.cos(index * .31)) * 46}px`;
    bar.style.setProperty('--delay', `${-(index % 13) * .21}s`);
    wave.append(bar);
  }
  if (!sample || typeof sample.previewText !== 'string' || !globalThis.TranscribeSegments) {
    $('#tour-caption').textContent = '示例资料未加载，请确认 assets 文件夹与页面保存在一起。';
    $('#submitBtn').disabled = true;
    $('#play-tour').disabled = true;
    return;
  }

  const app = $('#product-demo');
  const exports = $$('[data-export]');
  const planner = globalThis.TranscribeSegments;
  let mode = 'chunk';
  let minutes = 60;
  let plan = planner.build(sample.durationSeconds, mode, minutes);
  let state = 'idle';
  let generation = 0;
  let doneSegments = 0;
  let activeSegment = -1;
  let progress = 0;
  let showingTranscript = false;
  let abortAnimation = null;
  let toastTimer;
  let activeMilliseconds = 0;
  let runningSince = 0;
  let currentLog = [];
  let settingsNoticeShown = false;
  let stoppedDuringTour = false;
  $('#keywordSource').value = sample.description;
  $('#keyterms').value = sample.keyterms.join(', ');
  $('#charsValue').title = '完成后按所附完整 Markdown 文件统计，含说话人、时间戳和换行。';

  function toast(message) {
    clearTimeout(toastTimer);
    $('#toast').textContent = message;
    $('#toast').hidden = false;
    toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3000);
  }
  const sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration));
  const current = (token) => token === generation;
  const active = () => state === 'running' || state === 'tour';
  function invalidate() {
    generation++;
    if (abortAnimation) abortAnimation();
    $$('.pd-focus,.pd-attention').forEach((node) => node.classList.remove('pd-focus', 'pd-attention'));
    return generation;
  }
  function setState(next) {
    state = next;
    app.dataset.state = next;
    const status = $('#result-status');
    status.dataset.state = next;
    status.textContent = { idle: '等待开始', tour: '正在配置', running: '转录中', stopped: '已停止', done: '已完成' }[next];
    $('#submitBtn').disabled = active();
    $('#submitBtn span').textContent = next === 'done' ? '重新转录' : next === 'stopped' ? '重新开始' : next === 'running' ? '正在转录' : next === 'tour' ? '配置中' : '开始转录';
    $('#resumeBtn').disabled = next !== 'stopped';
    $('#cancelBtn').disabled = !active();
    $('#play-tour').disabled = active();
    $('#play-tour span').textContent = next === 'done' || next === 'stopped' ? '重播完整流程' : '播放完整流程';
    $('#control-hint').textContent = next === 'stopped' ? (mode === 'single' ? '整段音频尚未完成，可继续转录或重新开始。' : '已保存的分段会保留，继续时处理未完成部分。') : next === 'done' ? '转录完成，可以预览或下载文字。' : '演示已加速，可随时停止、继续。';
    for (const id of ['keyterms', 'keywordSource', 'diarize', 'numSpeakers', 'languageCode', 'extractKeytermsBtn']) {
      $(`#${id}`).disabled = active();
    }
    $('#chunkMode').disabled = active();
    $('#chunkMinutes').disabled = active() || $('#chunkMode').value === 'single';
    exports.forEach((button) => { button.disabled = next !== 'done'; });
    $('#result-panel').setAttribute('aria-busy', String(active()));
  }
  function setTourStep(index, caption) {
    $$('[data-tour-step]').forEach((node, position) => node.classList.toggle('active', position <= index));
    $('#tour-caption').textContent = caption;
  }
  function setProgress(value, label) {
    progress = Math.max(0, Math.min(100, value));
    $('#progress-track').setAttribute('aria-valuenow', String(Math.round(progress)));
    $('#progress-fill').style.width = `${progress}%`;
    $('#progress-percent').textContent = `${Math.floor(progress)}%`;
    if (label) $('#progress-label').textContent = label;
  }
  function segment(index, value, status, label, note) {
    $(`#segment-${index}`).dataset.state = status;
    $(`#segment-fill-${index}`).style.width = `${value}%`;
    $(`#segment-state-${index}`).textContent = label;
    if (note) $(`#segment-note-${index}`).textContent = note;
    $('#segment-count').textContent = `${doneSegments} / ${plan.length} 段完成`;
  }
  function isRecordedPlan() {
    return mode === 'chunk' && minutes === sample.chunkMinutes;
  }
  function configurationLabel() {
    return mode === 'single' ? '整段转录，不切分' : `每段 ${minutes} 分钟，共 ${plan.length} 段`;
  }
  function captureConfiguration(showValidity = false) {
    const input = $('#chunkMinutes');
    const nextMode = $('#chunkMode').value;
    $('#chunkOptions').hidden = nextMode === 'single';
    input.disabled = active() || nextMode === 'single';
    input.setCustomValidity('');
    try {
      const nextMinutes = input.valueAsNumber;
      const nextPlan = planner.build(sample.durationSeconds, nextMode, nextMinutes);
      mode = nextMode;
      minutes = nextMinutes;
      plan = nextPlan;
      input.removeAttribute('aria-invalid');
      $('#chunk-plan-hint').removeAttribute('data-tone');
      $('#chunk-plan-hint').textContent = mode === 'single'
        ? '整段音频一次提交，不做本地切分。'
        : `按 ${minutes} 分钟分成 ${plan.length} 段，逐段保存后合并成一份逐字稿。`;
      $('#processing-step-label').textContent = mode === 'single' ? '整段转录' : '分段转录';
      $('#case-record-note').textContent = isRecordedPlan()
        ? '原始案例：60 分钟 / 段，共 2 段，运行用时 2 分 06 秒。演示已加速。'
        : '当前仅演示所选处理流程，文字使用同一份真实样例。';
      return true;
    } catch (error) {
      input.setCustomValidity(error.message);
      input.setAttribute('aria-invalid', 'true');
      $('#chunk-plan-hint').dataset.tone = 'error';
      $('#chunk-plan-hint').textContent = error.message;
      if (showValidity) input.reportValidity();
      return false;
    }
  }
  function renderPlan() {
    const list = $('#segment-list');
    list.replaceChildren();
    $('#segmentBox').hidden = mode === 'single';
    plan.forEach((item, index) => {
      const article = document.createElement('article');
      article.className = 'pd-segment';
      article.id = `segment-${index}`;
      article.dataset.state = 'pending';
      const row = document.createElement('div');
      const number = document.createElement('strong');
      number.textContent = String(index + 1).padStart(2, '0');
      const range = document.createElement('span');
      range.textContent = `${planner.formatTime(item.start)} — ${planner.formatTime(item.end)}`;
      const status = document.createElement('em');
      status.id = `segment-state-${index}`;
      status.textContent = '等待处理';
      row.append(number, range, status);
      const meter = document.createElement('div');
      meter.className = 'pd-segment-meter';
      const fill = document.createElement('span');
      fill.id = `segment-fill-${index}`;
      meter.append(fill);
      const note = document.createElement('p');
      note.id = `segment-note-${index}`;
      note.textContent = `${planner.formatDuration(item.duration)} · ${index === plan.length - 1 ? '完成后整理逐字稿' : '逐段保存'}`;
      article.append(row, meter, note);
      list.append(article);
    });
    $('#segment-count').textContent = `${doneSegments} / ${plan.length} 段完成`;
  }
  function changeConfiguration() {
    if (active() || !captureConfiguration()) return;
    invalidate();
    resetOutput();
    setState('idle');
    setTourStep(0, `${configurationLabel()}，点击开始转录即可体验。`);
  }
  function log(message) {
    currentLog.push(message);
    $('#logText').textContent = currentLog.map((item, index) => `${String(index + 1).padStart(2, '0')}  ${item}`).join('\n');
  }
  function updateElapsed() {
    const elapsed = activeMilliseconds + (runningSince ? performance.now() - runningSince : 0);
    $('#elapsedValue').textContent = `${Math.floor(elapsed / 1000)} 秒`;
  }
  function animate(token, from, to, duration, label, updateSegment) {
    return new Promise((resolve) => {
      let raf = 0;
      let finished = false;
      const start = performance.now();
      const actualDuration = reducedMotion ? Math.min(duration, 200) : duration;
      function finish(success) {
        if (finished) return;
        finished = true;
        cancelAnimationFrame(raf);
        abortAnimation = null;
        resolve(success);
      }
      abortAnimation = () => finish(false);
      function frame(now) {
        if (!current(token)) { finish(false); return; }
        const fraction = Math.min(1, (now - start) / actualDuration);
        setProgress(from + (to - from) * fraction, label);
        if (updateSegment) updateSegment(fraction);
        updateElapsed();
        if (fraction >= 1) finish(true);
        else raf = requestAnimationFrame(frame);
      }
      raf = requestAnimationFrame(frame);
    });
  }

  function renderTranscript() {
    const preview = $('#preview');
    preview.replaceChildren();
    sample.previewText.split('\n').forEach((line) => {
      const match = /^Speaker (\d+) \[(\d{2}:\d{2}:\d{2})\]: ?(.*)$/.exec(line);
      const turn = document.createElement('article');
      turn.className = 'transcript-turn';
      if (match) {
        turn.dataset.speaker = match[1];
        const meta = document.createElement('div');
        meta.className = 'turn-meta';
        const dot = document.createElement('span');
        dot.className = 'speaker-dot';
        dot.setAttribute('aria-hidden', 'true');
        const speaker = document.createElement('span');
        speaker.textContent = `说话人 ${match[1]}`;
        const time = document.createElement('time');
        time.textContent = match[2];
        meta.append(dot, speaker, time);
        turn.append(meta);
      }
      const text = document.createElement('p');
      text.textContent = match ? match[3] : line;
      turn.append(text);
      preview.append(turn);
    });
    preview.scrollTop = 0;
  }
  function showTranscript() {
    showingTranscript = true;
    $('#empty-result').hidden = true;
    $('#transcript-result').hidden = false;
    $('#preview-badge').textContent = '前 500 字';
    renderTranscript();
  }
  function resetOutput() {
    doneSegments = 0;
    activeSegment = -1;
    showingTranscript = false;
    activeMilliseconds = 0;
    runningSince = 0;
    currentLog = [];
    $('#source-progress-fill').style.width = '100%';
    $('#source-progress-label').textContent = '100%';
    $('#source-progress-note').textContent = '音频已准备好';
    $('#preview').replaceChildren();
    $('#transcript-result').hidden = true;
    $('#empty-result').hidden = false;
    $('#preview-badge').textContent = '等待生成';
    $('#empty-message').textContent = '点击「开始转录」，查看这期播客的文字预览。';
    $('#elapsedLabel').textContent = '演示用时';
    $('#elapsedValue').textContent = '—';
    $('#charsValue').textContent = '—';
    $('#uploadValue').textContent = '—';
    $('#requestsValue').textContent = '—';
    $('#logText').textContent = '等待开始转录。';
    setProgress(0, '音频已就绪，等待开始');
    renderPlan();
    $('.pd-result-scroll').scrollTop = 0;
  }
  async function processAudio(token) {
    if (!current(token)) return;
    setState('running');
    setTourStep(2, mode === 'single' ? '整段提交，识别完成后整理为逐字稿。' : '每段完成后单独保存，最后合并成一份逐字稿。');
    $('#segmentBox').open = true;
    runningSince = performance.now();
    if (!currentLog.length) log(`示例音频已就绪，${configurationLabel()}。`);
    $('#empty-message').textContent = '正在演示云端识别，完成后显示逐字稿开头 500 字。';
    const perSegmentMilliseconds = 8900 / plan.length;
    for (let index = doneSegments; index < plan.length; index++) {
      if (!current(token)) return;
      activeSegment = index;
      const item = plan[index];
      const start = 5 + 92 * item.start / sample.durationSeconds;
      const saved = 5 + 92 * item.end / sample.durationSeconds;
      const uploaded = start + (saved - start) * .30;
      const recognized = start + (saved - start) * .90;
      const unit = mode === 'single' ? '整段音频' : `第 ${index + 1} 段`;
      $('#requestsValue').textContent = `${index + 1} 次`;
      $('#uploadValue').textContent = '上传中';
      log(`开始处理${unit}，演示上传音频。`);
      if (mode === 'chunk') $(`#segment-${index}`).scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'instant' : 'smooth' });
      if (!await animate(token, start, uploaded, perSegmentMilliseconds * .35, `${unit} · 正在上传音频`, (fraction) => {
        segment(index, fraction * 40, 'running', '上传中', `音频上传 ${Math.round(fraction * 100)}%`);
      })) return;
      $('#uploadValue').textContent = '已上传';
      log(`${unit}上传完成，等待识别结果。`);
      if (!await animate(token, uploaded, recognized, perSegmentMilliseconds * .55, `${unit} · 等待识别结果`, (fraction) => {
        segment(index, 40 + fraction * 54, 'running', '转录中', '正在识别文字、说话人和时间戳');
      })) return;
      if (!await animate(token, recognized, saved, perSegmentMilliseconds * .10, `${unit} · 保存逐字稿`, (fraction) => {
        segment(index, 94 + fraction * 6, 'running', '保存中', '整理文本并保存结果');
      })) return;
      doneSegments = index + 1;
      segment(index, 100, 'done', '已保存', '已完成，结果已保留');
      log(`${unit}已保存。`);
      if (!showingTranscript) showTranscript();
    }
    activeSegment = -1;
    setTourStep(3, '逐字稿已整理好，可以下载 Markdown。');
    const finishing = plan.length > 1 ? '合并分段结果，整理 Markdown' : '整理转录结果，生成 Markdown';
    log(finishing);
    if (!await animate(token, 97, 100, 700, finishing)) return;
    activeMilliseconds += performance.now() - runningSince;
    runningSince = 0;
    setState('done');
    setProgress(100, '转录完成，逐字稿已就绪');
    $('#charsValue').textContent = sample.fullCharacterCount.toLocaleString('en-US');
    if (isRecordedPlan()) {
      $('#elapsedLabel').textContent = '本次运行用时';
      $('#elapsedValue').textContent = '2 分 06 秒';
      $('#uploadValue').textContent = '16.7 秒';
    } else {
      $('#elapsedLabel').textContent = '演示用时';
      updateElapsed();
      $('#uploadValue').textContent = '演示完成';
    }
    $('#requestsValue').textContent = `${plan.length} 次`;
    log('转录完成，可以预览或下载逐字稿。');
    showTranscript();
    $('#transcript-result').scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'instant' : 'smooth' });
    $('#play-tour span').textContent = '重播完整流程';
  }
  function startNew() {
    if (!captureConfiguration(true)) return;
    const token = invalidate();
    resetOutput();
    app.scrollIntoView({ block: 'start', behavior: reducedMotion ? 'instant' : 'smooth' });
    processAudio(token);
  }
  function stop() {
    if (!active()) return;
    const previous = state;
    stoppedDuringTour = previous === 'tour';
    invalidate();
    if (runningSince) activeMilliseconds += performance.now() - runningSince;
    runningSince = 0;
    setState('stopped');
    setProgress(progress, mode === 'single' ? '已停止，可以继续转录' : '已停止，可继续处理未完成的分段');
    if (activeSegment >= 0 && activeSegment >= doneSegments) {
      const width = parseFloat($(`#segment-fill-${activeSegment}`).style.width) || 0;
      segment(activeSegment, width, 'stopped', '已停止', '继续时重新处理本段，已完成分段不受影响');
    }
    if (!showingTranscript) $('#empty-message').textContent = '任务已停止。点击「继续转录」，接着处理未完成部分。';
    log(previous === 'tour' ? '已停止流程演示，可继续转录本次示例。' : mode === 'single' ? '已停止整段转录，可重新提交未完成的音频。' : `已停止；保留 ${doneSegments} 段已完成结果。`);
    $('#tour-caption').textContent = mode === 'single' ? '已停止，可继续转录这段音频。' : '已停止。完成的分段会保留，未完成的可以继续。';
  }
  function resume() {
    if (state !== 'stopped') return;
    if (stoppedDuringTour) {
      $('#keyterms').value = sample.keyterms.join(', ');
      $('#keywordSource').value = sample.description;
      $('#source-progress-fill').style.width = '100%';
      $('#source-progress-label').textContent = '100%';
      $('#source-progress-note').textContent = '音频已准备好';
      stoppedDuringTour = false;
    }
    const token = invalidate();
    log(doneSegments >= plan.length ? '继续整理已完成的转录结果。' : mode === 'single' ? '重新提交未完成的整段音频。' : `继续处理，从第 ${doneSegments + 1} 段开始。`);
    processAudio(token);
  }
  async function typeInto(element, text, token, chunk = 2) {
    if (reducedMotion) { element.value = text; return current(token); }
    element.value = '';
    for (let index = 0; index < text.length; index += chunk) {
      if (!current(token)) return false;
      element.value = text.slice(0, index + chunk);
      await sleep(23);
    }
    return current(token);
  }
  function focusField(element) {
    $$('.pd-focus').forEach((node) => node.classList.remove('pd-focus'));
    element.classList.add('pd-focus');
    const scroll = $('#input-scroll');
    const offset = element.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
    scroll.scrollTo({ top: scroll.scrollTop + offset - 35, behavior: reducedMotion ? 'instant' : 'smooth' });
  }
  function extractKeywords(showMessage = true) {
    const text = $('#keywordSource').value.trim();
    if (!text) { if (showMessage) toast('先补充音频简介，再提取关键词。'); return; }
    const found = sample.keyterms.filter((term) => text.includes(term));
    if (!found.length) { if (showMessage) toast('没有提取到关键词，可以直接填入人名和术语。'); return; }
    const previous = $('#keyterms').value.split(/[,，、;；\n]/).map((term) => term.trim()).filter(Boolean);
    $('#keyterms').value = [...new Set([...previous, ...found])].join(', ');
    const output = $('#keywordOutput');
    output.replaceChildren();
    found.forEach((term) => { const chip = document.createElement('span'); chip.textContent = term; output.append(chip); });
    output.hidden = false;
    if (showMessage) toast(`已将 ${found.length} 个关键词补充到词库。`);
  }
  async function playTour() {
    if (!captureConfiguration(true)) return;
    const token = invalidate();
    resetOutput();
    setState('tour');
    app.scrollIntoView({ block: 'start', behavior: reducedMotion ? 'instant' : 'smooth' });
    $('#paramSettings').open = false;
    $('#chunkSettings').open = false;
    $('#keywordOutput').hidden = true;
    $('#input-scroll').scrollTop = 0;
    setTourStep(0, '准备好本地音频，检查时长和文件大小。');
    focusField($('#source-block'));
    $('#source-progress-fill').style.width = '0%';
    $('#source-progress-label').textContent = '0%';
    $('#source-progress-note').textContent = '正在准备示例音频';
    await sleep(reducedMotion ? 50 : 500);
    if (!current(token)) return;
    $('#source-progress-fill').style.width = '100%';
    $('#source-progress-label').textContent = '100%';
    $('#source-progress-note').textContent = '音频已准备好';
    await sleep(reducedMotion ? 50 : 650);
    if (!current(token)) return;
    setTourStep(1, '补充人名、专业词汇和节目介绍。');
    $('#paramSettings').open = true;
    focusField($('#keyterms-field'));
    if (!await typeInto($('#keyterms'), sample.keyterms.join(', '), token, 2)) return;
    await sleep(reducedMotion ? 50 : 550);
    if (!current(token)) return;
    focusField($('#description-field'));
    if (!await typeInto($('#keywordSource'), sample.description, token, 16)) return;
    $('#extractKeytermsBtn').classList.add('pd-attention');
    extractKeywords(false);
    await sleep(reducedMotion ? 50 : 800);
    if (!current(token)) return;
    $('#extractKeytermsBtn').classList.remove('pd-attention');
    $('#paramSettings').open = false;
    $('#chunkSettings').open = true;
    setTourStep(2, mode === 'single' ? '本次选择整段提交，不做本地切分。' : `本次按 ${minutes} 分钟切段，共 ${plan.length} 段。`);
    focusField($('#chunkSettings'));
    await sleep(reducedMotion ? 50 : 1000);
    if (!current(token)) return;
    $$('.pd-focus').forEach((node) => node.classList.remove('pd-focus'));
    $('#input-scroll').scrollTo({ top: 0, behavior: reducedMotion ? 'instant' : 'smooth' });
    $('#submitBtn').classList.add('pd-attention');
    await sleep(reducedMotion ? 50 : 400);
    if (!current(token)) return;
    $('#submitBtn').classList.remove('pd-attention');
    processAudio(token);
  }

  function downloadLink(url, name) {
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
  }
  function downloadFile(content, name, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    downloadLink(url, name);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  exports.forEach((button) => button.addEventListener('click', () => {
    if (state !== 'done') return;
    const kind = button.dataset.export;
    const name = `晚点聊-${sample.title}`;
    if (['md', 'txt', 'json'].includes(kind)) {
      const path = sample.downloads?.[kind];
      if (!path) { toast('下载资料未加载，请刷新页面后重试。'); return; }
      downloadLink(path, `${name}-完整逐字稿.${kind}`);
    }
    if (kind === 'report') {
      const report = [`${sample.title}｜原始案例运行记录`, `来源：${sample.source}`, '', `当前演示设置：${configurationLabel()}`, `当前演示请求次数：${plan.length} 次`, '', '以下信息为原始案例的实际运行记录：', '模型：ElevenLabs Scribe v2', '音频时长：01:39:26', '文件大小：91.8 MB', '切段设置：60 分钟，共 2 段', '本次完成用时：2 分 06 秒', '上传用时：16.7 秒', '请求次数：2 次', '', `本次补充 Markdown 的字符数：${sample.fullCharacterCount}（含说话人、时间戳与换行）`, '', '说明：展示页为加速演示，不会调用 API。界面仅预览开头500字；Markdown、TXT 和 JSON 下载均包含完整转录稿。JSON 由完整 Markdown 转换，非原始 API 响应。'];
      downloadFile(report.join('\n'), `${name}-运行记录.txt`, 'text/plain;charset=utf-8');
    }
    toast(kind === 'report' ? '已开始下载本次运行记录。' : '已开始下载完整逐字稿。');
  }));
  $('#chunkMode').addEventListener('change', changeConfiguration);
  $('#chunkMinutes').addEventListener('input', changeConfiguration);
  $('#transcribeForm').addEventListener('submit', (event) => { event.preventDefault(); if (!active()) startNew(); });
  $('#cancelBtn').addEventListener('click', stop);
  $('#resumeBtn').addEventListener('click', resume);
  $('#play-tour').addEventListener('click', () => { if (!active()) playTour(); });
  $('#extractKeytermsBtn').addEventListener('click', () => extractKeywords());
  $('#sample-file').addEventListener('click', () => {
    const details = $('#sample-file-details');
    details.hidden = !details.hidden;
    $('#sample-file').setAttribute('aria-expanded', String(!details.hidden));
  });
  for (const id of ['keyterms', 'keywordSource', 'diarize', 'numSpeakers', 'languageCode']) {
    $(`#${id}`).addEventListener('change', () => {
      if (settingsNoticeShown) return;
      settingsNoticeShown = true;
      toast('这里回放本次真实案例，修改演示设置不会重新识别音频。');
    });
  }
  captureConfiguration();
  resetOutput();
  setState('idle');
})();
