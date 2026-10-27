/* ============================================================
 * audio.js —— Web Audio 合成音效（tick 哒声 / 中奖叮咚）
 * 纯合成，无外部音频资源；AudioContext 需在用户手势后创建。
 * 开关关闭时不创建任何音频上下文。
 * ============================================================ */
(function () {
  'use strict';

  var ctx = null; // AudioContext 惰性创建
  var enabled = true;

  /** 创建/恢复 AudioContext；未启用或不可用时返回 null */
  function ensure() {
    if (!enabled) {
      return null;
    }
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) {
        return null;
      }
      ctx = new AC();
    }
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    return ctx;
  }

  /**
   * 播放一个带增益包络的单音
   * @param {AudioContext} ac 音频上下文
   * @param {number} freq 频率 Hz
   * @param {number} startAt 相对当前时间的起始秒
   * @param {number} dur 持续秒
   * @param {string} type 波形
   * @param {number} peak 峰值增益
   */
  function tone(ac, freq, startAt, dur, type, peak) {
    var t = ac.currentTime + startAt;
    var osc = ac.createOscillator();
    var gain = ac.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  window.AudioFX = {
    /** 设置音效开关；关闭时销毁上下文 */
    setEnabled: function (value) {
      enabled = Boolean(value);
      if (!enabled && ctx) {
        try {
          ctx.close();
        } catch (e) {
          /* 忽略关闭异常 */
        }
        ctx = null;
      }
    },

    /** 用户手势后调用，预热音频上下文 */
    unlock: function () {
      if (enabled) {
        ensure();
      }
    },

    /**
     * 旋转 tick 哒声：短促方波脉冲，频率随转速变化
     * @param {number} speed 转速估计 0~1
     */
    tick: function (speed) {
      var ac = ensure();
      if (!ac) {
        return;
      }
      var s = Math.max(0, Math.min(1, Number(speed) || 0));
      tone(ac, 560 + s * 760, 0, 0.05, 'square', 0.1);
    },

    /** 中奖上行双音「叮咚」 */
    win: function () {
      var ac = ensure();
      if (!ac) {
        return;
      }
      tone(ac, 659.25, 0, 0.18, 'sine', 0.22);   // E5 叮
      tone(ac, 880.0, 0.14, 0.26, 'sine', 0.22); // A5 咚
    }
  };
})();
