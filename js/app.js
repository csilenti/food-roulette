/* ============================================================
 * app.js —— 「今天吃什么 · 干饭命运转盘」应用逻辑
 * 状态机：IDLE → SPINNING（预抽取 + CSS transition 旋转）
 *        → RESULT（transitionend 触发：高亮 + 音效 + 小票）→ IDLE
 * 禁止 setTimeout 链硬编码流程；动画层由 wheel.js 提供。
 * ============================================================ */
(function () {
  'use strict';

  var STORAGE_KEY = 'food-wheel-state-v1';
  var MAX_ITEMS = 12;
  var MAX_NAME_LEN = 8;
  var HISTORY_LIMIT = 5;

  var REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------- 状态 ---------- */
  var state = {
    items: [],            // { id, name }
    phase: 'IDLE',        // 'IDLE' | 'SPINNING' | 'RESULT'
    targetIndex: null,    // 预抽取目标格
    rotation: 0,          // 转盘累计角度
    history: [],          // 最近 5 条 { name, timestamp, totalCandidates, hitIndex, ticketNo }
    soundOn: true,
    autoRemove: false,
    ambienceOn: false,
    ticketSeq: 1
  };

  var spinPlan = null;      // { to, duration }
  var rafId = 0;
  var rotor = null;
  var toastTimer = 0;
  var pendingRemove = false;
  var lastRecord = null;

  /* ---------- DOM 引用 ---------- */
  var els = {
    addForm: document.getElementById('add-form'),
    foodInput: document.getElementById('food-input'),
    addBtn: document.getElementById('add-btn'),
    editorHint: document.getElementById('editor-hint'),
    tagList: document.getElementById('tag-list'),
    editorLock: document.getElementById('editor-lock'),
    soundToggle: document.getElementById('sound-toggle'),
    removeToggle: document.getElementById('remove-toggle'),
    ambienceToggle: document.getElementById('ambience-toggle'),
    spinBtn: document.getElementById('spin-btn'),
    resetBtn: document.getElementById('reset-btn'),
    clearHistoryBtn: document.getElementById('clear-history-btn'),
    wheelContainer: document.getElementById('wheel-container'),
    spoon: document.getElementById('spoon'),
    bubble: document.getElementById('bubble'),
    bubbleText: document.getElementById('bubble-text'),
    historyList: document.getElementById('history-list'),
    historyEmpty: document.getElementById('history-empty'),
    receiptOverlay: document.getElementById('receipt-overlay'),
    receiptName: document.getElementById('receipt-name'),
    receiptMeta: document.getElementById('receipt-meta'),
    receiptNo: document.getElementById('receipt-no'),
    receiptTime: document.getElementById('receipt-time'),
    againBtn: document.getElementById('again-btn'),
    okBtn: document.getElementById('ok-btn'),
    toast: document.getElementById('toast')
  };

  /* ---------- 工具函数 ---------- */

  /** 取模（结果恒为非负） */
  function mod(a, b) {
    return ((a % b) + b) % b;
  }

  /** 随机整数 [0, n) —— 优先使用 crypto.getRandomValues */
  function randomIndex(n) {
    if (window.crypto && window.crypto.getRandomValues) {
      var buf = new Uint32Array(1);
      window.crypto.getRandomValues(buf);
      return buf[0] % n;
    }
    return Math.floor(Math.random() * n);
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function pad2(x) {
    return (x < 10 ? '0' : '') + x;
  }

  function pad6(x) {
    var s = String(x);
    while (s.length < 6) {
      s = '0' + s;
    }
    return s;
  }

  function formatTime(ts) {
    var d = new Date(ts);
    return (
      d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds())
    );
  }

  function formatShortTime(ts) {
    var d = new Date(ts);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }

  /* ---------- 持久化 ---------- */

  function save() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        items: state.items,
        history: state.history,
        soundOn: state.soundOn,
        autoRemove: state.autoRemove,
        ambienceOn: state.ambienceOn,
        ticketSeq: state.ticketSeq
      }));
    } catch (e) {
      /* 隐私模式等场景下静默降级为不持久化 */
    }
  }

  function load() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return false;
      }
      var data = JSON.parse(raw);
      if (Array.isArray(data.items)) {
        state.items = data.items
          .filter(function (it) {
            return it && typeof it.name === 'string' && it.name.length > 0;
          })
          .slice(0, MAX_ITEMS)
          .map(function (it) {
            return { id: String(it.id || uid()), name: it.name.slice(0, MAX_NAME_LEN) };
          });
      }
      if (Array.isArray(data.history)) {
        state.history = data.history.slice(0, HISTORY_LIMIT);
      }
      if (typeof data.soundOn === 'boolean') {
        state.soundOn = data.soundOn;
      }
      if (typeof data.autoRemove === 'boolean') {
        state.autoRemove = data.autoRemove;
      }
      if (typeof data.ambienceOn === 'boolean') {
        state.ambienceOn = data.ambienceOn;
      }
      if (typeof data.ticketSeq === 'number' && data.ticketSeq > 0) {
        state.ticketSeq = Math.floor(data.ticketSeq);
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function loadDefaults() {
    var defaults = ['火锅', '烧烤', '日料', '麻辣烫', '汉堡', '面条', '饺子', '沙拉'];
    state.items = defaults.map(function (name) {
      return { id: uid(), name: name };
    });
  }

  /* ---------- 轻提示 ---------- */

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('is-visible');
    if (toastTimer) {
      window.clearTimeout(toastTimer);
    }
    toastTimer = window.setTimeout(function () {
      els.toast.classList.remove('is-visible');
      toastTimer = 0;
    }, 2200);
  }

  /* ---------- 渲染 ---------- */

  function renderWheel() {
    rotor = Wheel.render(els.wheelContainer, state.items);
    // 列表变化重建 SVG 后，恢复当前累计角度（无动画）
    Wheel.setRotation(rotor, state.rotation, { animate: false });
    if (state.phase === 'RESULT' && state.targetIndex !== null) {
      Wheel.highlight(els.wheelContainer, state.targetIndex);
    }
  }

  function renderTags() {
    var locked = state.phase !== 'IDLE';
    els.tagList.innerHTML = '';
    state.items.forEach(function (item, i) {
      var li = document.createElement('li');
      li.className = 'tag';

      var swatch = document.createElement('span');
      swatch.className = 'tag-swatch';
      swatch.style.background = Wheel.COLORS[i % Wheel.COLORS.length];

      var name = document.createElement('span');
      name.className = 'tag-name';
      name.textContent = item.name;

      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'tag-remove';
      remove.textContent = '×';
      remove.setAttribute('data-id', item.id);
      remove.setAttribute('aria-label', '删除 ' + item.name);
      remove.disabled = locked;

      li.appendChild(swatch);
      li.appendChild(name);
      li.appendChild(remove);
      els.tagList.appendChild(li);
    });
  }

  function renderHistory() {
    els.historyList.innerHTML = '';
    els.historyEmpty.hidden = state.history.length > 0;

    state.history.forEach(function (record, i) {
      var li = document.createElement('li');
      li.className = 'history-item' + (i === 0 ? ' is-latest' : '');

      var rank = document.createElement('span');
      rank.className = 'history-rank';
      rank.textContent = 'NO.' + pad6(record.ticketNo || i + 1);

      var name = document.createElement('span');
      name.className = 'history-name';
      name.textContent = record.name;

      var meta = document.createElement('span');
      meta.className = 'history-time';
      meta.textContent = '候选 ' + record.totalCandidates + ' 项 · ' + formatShortTime(record.timestamp);

      li.appendChild(rank);
      li.appendChild(name);
      li.appendChild(meta);
      els.historyList.appendChild(li);
    });
  }

  function renderHint() {
    var n = state.items.length;
    if (n === 0) {
      els.editorHint.textContent = '转盘空空如也，先添加至少 2 个候选吧';
    } else if (n === 1) {
      els.editorHint.textContent = '至少需要 2 个候选才能开转';
    } else {
      els.editorHint.textContent = '转盘上已有 ' + n + ' 个候选（最多 ' + MAX_ITEMS + ' 个）';
    }
  }

  /** 氛围模式台词气泡：按阶段切换 */
  function updateBubble() {
    if (!state.ambienceOn) {
      els.bubble.hidden = true;
      return;
    }
    els.bubble.hidden = false;
    if (state.phase === 'SPINNING') {
      els.bubbleText.textContent = '别盯着看，我看你盯的这格它偏不停。';
    } else if (state.phase === 'RESULT' && lastRecord) {
      els.bubbleText.textContent = lastRecord.name + '！命运已判决，开饭！';
    } else {
      els.bubbleText.textContent =
        state.items.length + ' 个候选我都记下了，转起来吧！';
    }
  }

  /** 同步各控件可用态与按钮文案 */
  function updateControls() {
    var spinning = state.phase === 'SPINNING';
    var editable = state.phase === 'IDLE';

    els.spinBtn.disabled = spinning || state.items.length < 2;
    els.spinBtn.textContent = spinning ? '旋转中...' : '开始抽奖';
    els.resetBtn.disabled = spinning;
    els.clearHistoryBtn.disabled = spinning;
    els.addBtn.disabled = !editable;
    els.foodInput.disabled = !editable;
    els.editorLock.hidden = !spinning;

    renderTags();
  }

  function renderAll() {
    renderWheel();
    renderTags();
    renderHistory();
    renderHint();
    updateControls();
    updateBubble();
  }

  /* ---------- 候选编辑 ---------- */

  function addItem() {
    if (state.phase !== 'IDLE') {
      return;
    }
    var name = els.foodInput.value.trim();
    if (!name) {
      showToast('先输入一个食物名称');
      els.foodInput.focus();
      return;
    }
    if (state.items.length >= MAX_ITEMS) {
      showToast('转盘最多放 ' + MAX_ITEMS + ' 个候选');
      return;
    }
    var truncated = false;
    if (name.length > MAX_NAME_LEN) {
      name = name.slice(0, MAX_NAME_LEN);
      truncated = true;
    }
    var duplicated = state.items.some(function (it) {
      return it.name === name;
    });
    if (duplicated) {
      showToast('「' + name + '」已经在转盘上啦');
      return;
    }
    state.items.push({ id: uid(), name: name });
    els.foodInput.value = '';
    if (truncated) {
      showToast('名称最多 8 个字，已截断');
    }
    save();
    renderAll();
  }

  function removeItem(id) {
    if (state.phase !== 'IDLE') {
      return;
    }
    var next = [];
    for (var i = 0; i < state.items.length; i++) {
      if (state.items[i].id !== id) {
        next.push(state.items[i]);
      }
    }
    if (next.length === state.items.length) {
      return;
    }
    state.items = next;
    save();
    renderAll();
  }

  /* ---------- 旋转：tick 循环 ---------- */

  /** 计算指针（正上方）当前压在哪一格 */
  function pointerIndexAt(rotDeg) {
    var n = state.items.length;
    if (!n) {
      return 0;
    }
    var seg = 360 / n;
    return Math.floor(mod(-rotDeg, 360) / seg) % n;
  }

  function startTickLoop() {
    var lastIndex = pointerIndexAt(Wheel.getRotation(rotor));
    var lastRot = Wheel.getRotation(rotor);
    var speed = 0;

    var step = function () {
      if (state.phase !== 'SPINNING') {
        rafId = 0;
        return;
      }
      var rot = Wheel.getRotation(rotor);
      var delta = rot - lastRot;
      lastRot = rot;
      // 转速估计：随帧间角速度平滑变化，用于 tick 音高
      speed = Math.min(1, Math.max(speed * 0.88, Math.abs(delta) / 14));

      var idx = pointerIndexAt(rot);
      if (idx !== lastIndex) {
        lastIndex = idx;
        AudioFX.tick(speed);
      }
      rafId = window.requestAnimationFrame(step);
    };
    rafId = window.requestAnimationFrame(step);
  }

  function stopTickLoop() {
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  /* ---------- 状态机流转 ---------- */

  /** IDLE → SPINNING：预抽取目标格，计算对齐角度并发起旋转 */
  function startSpin() {
    if (state.phase !== 'IDLE') {
      return;
    }
    if (state.items.length === 0) {
      showToast('转盘空空如也，先添加至少 2 个候选吧');
      return;
    }
    if (state.items.length < 2) {
      showToast('至少需要 2 个候选才能开转');
      return;
    }

    var n = state.items.length;
    var seg = 360 / n;

    // 结果在点击这一刻就已决定，动画只是揭晓过程
    state.targetIndex = randomIndex(n);

    // 对齐：指针在正上方（0°），需让目标扇形中线转到指针处
    // 目标扇形中线（转子坐标系，自顶部顺时针）= targetIndex*seg + seg/2
    var requiredMod = mod(360 - (state.targetIndex * seg + seg / 2), 360);
    var from = state.rotation;
    var delta = mod(requiredMod - mod(from, 360), 360);
    var fullSpins = 5 + randomIndex(3); // 5~7 整圈
    var to = from + fullSpins * 360 + delta;
    var duration = 4200 + randomIndex(801); // 4.2s ~ 5s

    spinPlan = { to: to, duration: duration };
    state.phase = 'SPINNING';

    Wheel.clearHighlight(els.wheelContainer);
    els.spoon.classList.add('is-spinning');
    updateControls();
    updateBubble();
    save();

    if (REDUCED_MOTION.matches) {
      // 降级：不做旋转动画，直接落定后淡入揭晓
      state.rotation = to;
      Wheel.setRotation(rotor, to, { animate: false });
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(finishSpin);
      });
      return;
    }

    // 「再来一次」路径：settleAfterResult → renderAll → renderWheel 会在本任务内
    // 重建 rotor（全新插入的元素没有 before-change style）。必须先把基础角度以
    // 无过渡方式提交，并强制样式重算，使本任务内建立 before-change style，
    // 随后的 transition 才会真正触发（否则 transitionend 永不触发，状态机卡死）。
    Wheel.setRotation(rotor, state.rotation, { animate: false });
    void rotor.getBoundingClientRect(); // 强制样式重算（flush style/layout）
    Wheel.setRotation(rotor, to, { animate: true, duration: duration });
    startTickLoop();
  }

  /** SPINNING → RESULT：高亮 + 音效 + 历史 + 小票 */
  function finishSpin() {
    if (state.phase !== 'SPINNING' || state.targetIndex === null) {
      return;
    }
    stopTickLoop();

    state.rotation = spinPlan ? spinPlan.to : state.rotation;
    state.phase = 'RESULT';
    els.spoon.classList.remove('is-spinning');

    var index = state.targetIndex;
    var item = state.items[index];
    if (!item) {
      // 防御：目标格不存在时直接回到待机
      state.phase = 'IDLE';
      state.targetIndex = null;
      updateControls();
      updateBubble();
      return;
    }

    lastRecord = {
      name: item.name,
      timestamp: Date.now(),
      totalCandidates: state.items.length,
      hitIndex: index,
      ticketNo: state.ticketSeq
    };
    state.ticketSeq += 1;
    state.history.unshift(lastRecord);
    state.history = state.history.slice(0, HISTORY_LIMIT);
    pendingRemove = state.autoRemove;

    AudioFX.win();
    Wheel.highlight(els.wheelContainer, index);

    updateControls();
    updateBubble();
    renderHistory();
    save();
    showReceipt(lastRecord);
  }

  /** RESULT → IDLE：关闭小票，按需移除抽中项 */
  function settleAfterResult(thenRespin) {
    if (state.phase === 'SPINNING') {
      return;
    }
    closeReceipt();
    Wheel.clearHighlight(els.wheelContainer);

    if (pendingRemove && state.targetIndex !== null) {
      state.items.splice(state.targetIndex, 1);
      pendingRemove = false;
    }
    state.phase = 'IDLE';
    state.targetIndex = null;
    save();
    renderAll();

    if (thenRespin) {
      startSpin();
    }
  }

  /* ---------- 小票结果卡 ---------- */

  function showReceipt(record) {
    els.receiptName.textContent = record.name.length > 1
      ? record.name.split('').join(' ')
      : record.name;
    els.receiptMeta.textContent =
      '候选 ' + record.totalCandidates + ' 项 · 第 ' + (record.hitIndex + 1) + ' 格';
    els.receiptNo.textContent = 'NO.' + pad6(record.ticketNo);
    els.receiptTime.textContent = formatTime(record.timestamp);

    els.receiptOverlay.hidden = false;
    // 下一帧再加 is-open，保证透明度过渡生效
    window.requestAnimationFrame(function () {
      els.receiptOverlay.classList.add('is-open');
      els.okBtn.focus();
    });
  }

  function closeReceipt() {
    els.receiptOverlay.classList.remove('is-open');
    els.receiptOverlay.hidden = true;
  }

  /* ---------- 重置 ---------- */

  function resetWheel() {
    if (state.phase === 'SPINNING') {
      return;
    }
    closeReceipt();
    Wheel.clearHighlight(els.wheelContainer);
    pendingRemove = false;
    state.phase = 'IDLE';
    state.targetIndex = null;
    state.rotation = 0;
    Wheel.setRotation(rotor, 0, { animate: !REDUCED_MOTION.matches, duration: 600 });
    updateControls();
    updateBubble();
    showToast('转盘已回正');
  }

  function clearHistory() {
    if (state.history.length === 0) {
      showToast('还没有历史记录');
      return;
    }
    state.history = [];
    save();
    renderHistory();
    showToast('历史记录已清空');
  }

  /* ---------- 事件绑定 ---------- */

  function bindEvents() {
    // 添加候选：按钮 / 回车
    els.addForm.addEventListener('submit', function (e) {
      e.preventDefault();
      addItem();
    });

    // 删除候选（事件委托）
    els.tagList.addEventListener('click', function (e) {
      var target = e.target;
      if (target && target.classList && target.classList.contains('tag-remove')) {
        removeItem(target.getAttribute('data-id'));
      }
    });

    // 开始抽奖
    els.spinBtn.addEventListener('click', startSpin);

    // 转子 CSS transition 结束 → 进入 RESULT（禁止 setTimeout 链的原因）。
    // 委托到容器：列表变化会重建 SVG/转子，直接绑在 rotor 上会失效。
    els.wheelContainer.addEventListener('transitionend', function (e) {
      if (
        e.propertyName === 'transform' &&
        e.target === rotor &&
        state.phase === 'SPINNING'
      ) {
        finishSpin();
      }
    });

    // 重置 / 清空历史
    els.resetBtn.addEventListener('click', resetWheel);
    els.clearHistoryBtn.addEventListener('click', clearHistory);

    // 开关
    els.soundToggle.addEventListener('change', function () {
      state.soundOn = els.soundToggle.checked;
      AudioFX.setEnabled(state.soundOn);
      if (state.soundOn) {
        AudioFX.unlock();
      }
      save();
    });
    els.removeToggle.addEventListener('change', function () {
      state.autoRemove = els.removeToggle.checked;
      save();
    });
    els.ambienceToggle.addEventListener('change', function () {
      state.ambienceOn = els.ambienceToggle.checked;
      updateBubble();
      save();
    });

    // 小票按钮
    els.okBtn.addEventListener('click', function () {
      settleAfterResult(false);
    });
    els.againBtn.addEventListener('click', function () {
      settleAfterResult(true);
    });

    // 点击遮罩 / Esc = 就吃这个
    els.receiptOverlay.addEventListener('click', function (e) {
      if (e.target === els.receiptOverlay) {
        settleAfterResult(false);
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !els.receiptOverlay.hidden) {
        settleAfterResult(false);
      }
    });

    // 首次用户手势后预热 AudioContext（浏览器自动播放策略要求）
    var unlockOnce = function () {
      if (state.soundOn) {
        AudioFX.unlock();
      }
      document.removeEventListener('pointerdown', unlockOnce);
      document.removeEventListener('keydown', unlockOnce);
    };
    document.addEventListener('pointerdown', unlockOnce);
    document.addEventListener('keydown', unlockOnce);
  }

  /* ---------- 启动 ---------- */

  function init() {
    if (!load()) {
      loadDefaults();
    }
    els.soundToggle.checked = state.soundOn;
    els.removeToggle.checked = state.autoRemove;
    els.ambienceToggle.checked = state.ambienceOn;
    AudioFX.setEnabled(state.soundOn);

    renderAll();
    bindEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
