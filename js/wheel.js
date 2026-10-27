/* ============================================================
 * wheel.js —— SVG 餐盘转盘渲染
 * 职责：根据候选数组动态生成扇形 path + 沿中线旋转的文字标签，
 *       提供旋转（CSS transition）、停止位置读取、中奖高亮等 API。
 * 仅操作 DOM/SVG，不持有业务状态。
 * ============================================================ */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  /** 暖色扇形循环盘（对外暴露，供标签色板复用） */
  var COLORS = ['#E4572E', '#F5B700', '#7A9E4F', '#D97B3F'];
  var TEXT_COLORS = ['#FFF6EA', '#2B2118', '#2B2118', '#2B2118'];

  var CX = 210;
  var CY = 210;
  var R_SECTOR = 182; // 扇形外半径
  var R_LABEL = 118;  // 文字放置半径

  /** 创建 SVG 元素并批量设置属性 */
  function svgEl(tag, attrs) {
    var node = document.createElementNS(NS, tag);
    if (attrs) {
      for (var key in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, key)) {
          node.setAttribute(key, attrs[key]);
        }
      }
    }
    return node;
  }

  /**
   * 极坐标转换：angle 为「自正上方起、顺时针」的角度（度）
   */
  function polar(angleDeg, radius) {
    var rad = ((angleDeg - 90) * Math.PI) / 180;
    return {
      x: CX + radius * Math.cos(rad),
      y: CY + radius * Math.sin(rad)
    };
  }

  /** 生成单个扇形 path 的 d 属性 */
  function sectorPath(startDeg, endDeg, radius) {
    var p1 = polar(startDeg, radius);
    var p2 = polar(endDeg, radius);
    var largeArc = endDeg - startDeg > 180 ? 1 : 0;
    return (
      'M ' + CX + ' ' + CY +
      ' L ' + p1.x.toFixed(2) + ' ' + p1.y.toFixed(2) +
      ' A ' + radius + ' ' + radius + ' 0 ' + largeArc + ' 1 ' +
      p2.x.toFixed(2) + ' ' + p2.y.toFixed(2) + ' Z'
    );
  }

  /**
   * 计算扇形中线文字的旋转角。
   * 文字沿半径方向「由中心向外」读（rot = mid - 90）；当读向角落在
   * (90°, 270°)（即文字头朝下）时旋转 180° 翻转为「由外向内」读。
   * 该区间对应中线角 midDeg ≥ 180（转盘左半侧及正下方）。
   */
  function labelRotation(midDeg) {
    var rot = midDeg - 90;
    if (midDeg >= 180) {
      rot += 180;
    }
    return rot;
  }

  /** 依据候选数量选择标签字号 */
  function labelFontSize(count) {
    if (count <= 6) {
      return 30;
    }
    if (count <= 9) {
      return 24;
    }
    return 19;
  }

  /** 构建空转盘占位（候选为 0 时） */
  function buildPlaceholder(svg) {
    var ring = svgEl('circle', {
      cx: CX,
      cy: CY,
      r: 150,
      fill: '#F7E8D4',
      stroke: '#2B2118',
      'stroke-width': 3,
      'stroke-dasharray': '10 8'
    });
    svg.appendChild(ring);

    var text = svgEl('text', {
      x: CX,
      y: CY,
      'text-anchor': 'middle',
      'dominant-baseline': 'middle',
      'font-size': 26,
      class: 'wheel-placeholder'
    });
    text.textContent = '空空如也';
    svg.appendChild(text);
  }

  /**
   * 渲染转盘。
   * @param {HTMLElement} container 容器元素（清空后重建）
   * @param {Array<{id:string,name:string}>} items 候选数组（2~12 项或为空）
   * @returns {SVGGElement} 转子 <g>，调用方对其施加 rotate 变换
   */
  function render(container, items) {
    container.innerHTML = '';

    var svg = svgEl('svg', {
      viewBox: '0 0 420 420',
      class: 'wheel-svg',
      role: 'img',
      'aria-label': '餐盘转盘'
    });

    // 餐盘底盘与内圈描边
    svg.appendChild(svgEl('circle', {
      cx: CX, cy: CY, r: 204,
      fill: '#FFF6EA', stroke: '#2B2118', 'stroke-width': 6
    }));
    svg.appendChild(svgEl('circle', {
      cx: CX, cy: CY, r: 194,
      fill: '#FFFDF7', stroke: '#E8D9C3', 'stroke-width': 2
    }));

    // 转子（扇形 + 文字都放里面，整体旋转）
    var rotor = svgEl('g', { class: 'wheel-rotor' });
    svg.appendChild(rotor);

    var count = items ? items.length : 0;
    if (count === 0) {
      buildPlaceholder(svg);
    } else {
      var seg = 360 / count;
      var fontSize = labelFontSize(count);

      for (var i = 0; i < count; i++) {
        var colorIdx = i % COLORS.length;
        var shape;
        if (count === 1) {
          // 只剩 1 项时扇形起止端点重合（0°~360°），SVG 弧段会退化消失，
          // 改画整圆保持暖色盘配色与中奖高亮能力
          shape = svgEl('circle', {
            cx: CX,
            cy: CY,
            r: R_SECTOR,
            fill: COLORS[colorIdx],
            class: 'wheel-sector',
            'data-index': String(i)
          });
        } else {
          shape = svgEl('path', {
            d: sectorPath(i * seg, (i + 1) * seg, R_SECTOR),
            fill: COLORS[colorIdx],
            class: 'wheel-sector',
            'data-index': String(i)
          });
        }
        rotor.appendChild(shape);

        var mid = i * seg + seg / 2;
        var pos = polar(mid, R_LABEL);
        // 单项时文字水平放在圆盘下方居中，不做径向旋转
        var labelAttrs = {
          x: pos.x.toFixed(2),
          y: pos.y.toFixed(2),
          fill: TEXT_COLORS[colorIdx],
          'font-size': count === 1 ? Math.max(fontSize, 34) : fontSize,
          'text-anchor': 'middle',
          'dominant-baseline': 'middle',
          'paint-order': 'stroke',
          stroke: 'rgba(43,33,24,0.25)',
          'stroke-width': 3,
          class: 'wheel-label'
        };
        if (count > 1) {
          labelAttrs.transform =
            'rotate(' + labelRotation(mid).toFixed(2) + ' ' +
            pos.x.toFixed(2) + ' ' + pos.y.toFixed(2) + ')';
        }
        var label = svgEl('text', labelAttrs);
        label.textContent = items[i].name;
        rotor.appendChild(label);
      }
    }

    // 中心圆帽（不随转子旋转，压在扇形之上）
    svg.appendChild(svgEl('circle', {
      cx: CX, cy: CY, r: 34,
      fill: '#F5B700', stroke: '#2B2118', 'stroke-width': 5
    }));
    svg.appendChild(svgEl('circle', {
      cx: CX, cy: CY, r: 10, fill: '#2B2118'
    }));

    container.appendChild(svg);
    return rotor;
  }

  /**
   * 施加旋转角。
   * @param {SVGGElement} rotor 转子
   * @param {number} deg 目标累计角度
   * @param {{animate?: boolean, duration?: number, easing?: string}} [opts]
   */
  function setRotation(rotor, deg, opts) {
    if (!rotor) {
      return;
    }
    opts = opts || {};
    if (opts.animate) {
      var duration = opts.duration || 4000;
      var easing = opts.easing || 'cubic-bezier(0.45, 0, 0.1, 1)';
      rotor.style.transition = 'transform ' + duration + 'ms ' + easing;
    } else {
      rotor.style.transition = 'none';
    }
    rotor.style.transform = 'rotate(' + deg + 'deg)';
  }

  /**
   * 读取转子当前的**视觉**角度（来自 computed matrix，值域 -180~180）。
   * 用于 rAF tick 循环检测扫过的扇形边界；索引计算只依赖角度 mod 360，
   * 因此取模后与累计角度等价。
   * @param {SVGGElement} rotor
   * @returns {number}
   */
  function getRotation(rotor) {
    if (!rotor) {
      return 0;
    }
    var transform = window.getComputedStyle(rotor).transform;
    if (!transform || transform === 'none') {
      return 0;
    }
    var match = transform.match(/matrix\(([^)]+)\)/);
    if (!match) {
      return 0;
    }
    var parts = match[1].split(',');
    var a = parseFloat(parts[0]);
    var b = parseFloat(parts[1]);
    return (Math.atan2(b, a) * 180) / Math.PI;
  }

  /** 高亮指定序号扇形（白描边 + 缩放脉冲，见 CSS） */
  function highlight(container, index) {
    var path = container.querySelector('.wheel-sector[data-index="' + index + '"]');
    if (path) {
      path.classList.add('is-winning');
    }
  }

  /** 清除全部高亮 */
  function clearHighlight(container) {
    var paths = container.querySelectorAll('.wheel-sector.is-winning');
    for (var i = 0; i < paths.length; i++) {
      paths[i].classList.remove('is-winning');
    }
  }

  window.Wheel = {
    COLORS: COLORS,
    TEXT_COLORS: TEXT_COLORS,
    render: render,
    setRotation: setRotation,
    getRotation: getRotation,
    highlight: highlight,
    clearHighlight: clearHighlight
  };
})();
