/**
 * ============================================================================
 * SSD.Charts — leichtgewichtige, abhängigkeitsfreie SVG-Diagramme
 * ============================================================================
 * Es wird bewusst keine externe Chart-Bibliothek eingebunden (kein CDN, kein
 * Internetzugriff nötig). Die hier erzeugten Diagramme reichen für die in der
 * Statistik-Ansicht benötigten Visualisierungen völlig aus und bleiben in
 * Größe und Darstellung vollständig unter eigener Kontrolle.
 */
window.SSD = window.SSD || {};

SSD.Charts = (function () {
  'use strict';

  const U = SSD.Utils;

  const PALETTE = {
    mixed: '#16a34a', boys: '#d97706', girls: '#db2777', empty: '#cbd5e3',
    primary: '#2f6feb', primaryLight: '#85b6ff', accent: '#06b6d4', danger: '#dc2626',
    series: ['#2f6feb', '#06b6d4', '#d97706', '#db2777', '#16a34a', '#7c3aed', '#dc2626', '#0891b2'],
  };

  function svgEl(tag, attrs) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, v));
    return node;
  }

  /**
   * Horizontale Balkenliste — gut geeignet für viele Kategorien (z. B. Dienste
   * pro Schüler), da Labels links immer lesbar bleiben statt sich auf einer
   * x-Achse zu überlappen.
   * @param {HTMLElement} container
   * @param {Array<{label:string, value:number, color?:string, sublabel?:string}>} items
   */
  function horizontalBarList(container, items, options = {}) {
    container.innerHTML = '';
    if (!items.length) {
      container.appendChild(U.el('div', { class: 'empty-state' }, ['Keine Daten vorhanden.']));
      return;
    }
    const max = options.max || Math.max(1, ...items.map((i) => i.value));
    const list = U.el('div', { class: 'stack gap-3' });
    items.forEach((item, idx) => {
      const pct = Math.max(2, Math.round((item.value / max) * 100));
      const row = U.el('div', { class: 'stack gap-1', style: `animation: rise-in 300ms ease both; animation-delay:${idx * 25}ms` }, [
        U.el('div', { class: 'cluster', style: 'justify-content:space-between; font-size:var(--font-size-sm);' }, [
          U.el('span', { style: 'font-weight:600;' }, [item.label]),
          U.el('span', { class: 'mono text-secondary', style: 'font-weight:700;' }, [String(options.valueFormatter ? options.valueFormatter(item.value) : item.value)]),
        ]),
        U.el('div', { class: 'progress-bar' }, [
          U.el('div', { class: 'progress-bar__fill', style: `width:${pct}%; background:${item.color || PALETTE.primary};` }),
        ]),
        item.sublabel ? U.el('div', { class: 'text-tertiary', style: 'font-size:var(--font-size-xs);' }, [item.sublabel]) : null,
      ]);
      list.appendChild(row);
    });
    container.appendChild(list);
  }

  /**
   * Donut-Diagramm mit Legende (z. B. Geschlechterverteilung der Dienste).
   * @param {Array<{label:string, value:number, color:string}>} items
   */
  function donutChart(container, items, options = {}) {
    container.innerHTML = '';
    const size = options.size || 168;
    const thickness = options.thickness || 22;
    const radius = (size - thickness) / 2;
    const circumference = 2 * Math.PI * radius;
    const total = items.reduce((sum, i) => sum + i.value, 0);

    const wrap = U.el('div', { class: 'cluster gap-5', style: 'align-items:center;' });
    const svg = svgEl('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, style: 'flex:none; transform: rotate(-90deg);' });

    svg.appendChild(svgEl('circle', {
      cx: size / 2, cy: size / 2, r: radius, fill: 'none',
      stroke: 'var(--bg-sunken)', 'stroke-width': thickness,
    }));

    let offset = 0;
    if (total > 0) {
      items.filter((i) => i.value > 0).forEach((item) => {
        const fraction = item.value / total;
        const dash = fraction * circumference;
        const circle = svgEl('circle', {
          cx: size / 2, cy: size / 2, r: radius, fill: 'none',
          stroke: item.color, 'stroke-width': thickness,
          'stroke-dasharray': `${dash} ${circumference - dash}`,
          'stroke-dashoffset': -offset,
          'stroke-linecap': items.filter((i) => i.value > 0).length > 1 ? 'butt' : 'round',
        });
        circle.style.transition = 'stroke-dasharray 500ms ease';
        svg.appendChild(circle);
        offset += dash;
      });
    }

    const centerWrap = U.el('div', { style: `position:relative; width:${size}px; height:${size}px;` }, [svg]);
    const centerText = U.el('div', {
      style: 'position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center;',
    }, [
      U.el('div', { style: 'font-size:var(--font-size-2xl); font-weight:800;' }, [String(options.centerValue ?? total)]),
      U.el('div', { class: 'text-tertiary', style: 'font-size:var(--font-size-xs); font-weight:600;' }, [options.centerLabel || 'Gesamt']),
    ]);
    centerWrap.appendChild(centerText);

    const legend = U.el('div', { class: 'stack gap-2' });
    items.forEach((item) => {
      const pct = total > 0 ? Math.round((item.value / total) * 100) : 0;
      legend.appendChild(U.el('div', { class: 'cluster gap-2', style: 'font-size:var(--font-size-sm);' }, [
        U.el('span', { class: 'legend__swatch', style: `background:${item.color};` }),
        U.el('span', { style: 'font-weight:600; min-width:110px;' }, [item.label]),
        U.el('span', { class: 'text-tertiary mono' }, [`${item.value} (${pct}%)`]),
      ]));
    });

    wrap.appendChild(centerWrap);
    wrap.appendChild(legend);
    container.appendChild(wrap);
  }

  /**
   * Einfaches vertikales Säulendiagramm (z. B. Verteilung über die Wochentage).
   * @param {Array<{label:string, value:number, color?:string}>} items
   */
  function columnChart(container, items, options = {}) {
    container.innerHTML = '';
    const height = options.height || 160;
    const max = Math.max(1, ...items.map((i) => i.value));
    const barWidth = 100 / items.length;

    const wrap = U.el('div', { style: `display:flex; align-items:flex-end; gap:${options.gap || 10}px; height:${height}px;` });
    items.forEach((item, idx) => {
      const barHeightPct = Math.max(3, (item.value / max) * 100);
      const col = U.el('div', { style: 'flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%; gap:6px;' }, [
        U.el('div', { class: 'mono', style: 'font-size:var(--font-size-xs); font-weight:700; color:var(--text-secondary);' }, [String(item.value)]),
        U.el('div', {
          style: `width:100%; max-width:38px; height:${barHeightPct}%; border-radius:8px 8px 4px 4px; background:${item.color || PALETTE.primary}; animation: rise-in 400ms ease both; animation-delay:${idx * 40}ms;`,
        }),
        U.el('div', { class: 'text-tertiary', style: 'font-size:var(--font-size-xs); font-weight:600;' }, [item.label]),
      ]);
      wrap.appendChild(col);
    });
    container.appendChild(wrap);
  }

  /** Kleine Sparkline zur dezenten Trendanzeige (z. B. auf KPI-Kacheln). */
  function sparkline(container, values, options = {}) {
    container.innerHTML = '';
    if (values.length < 2) return;
    const width = options.width || 100;
    const height = options.height || 28;
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const range = max - min || 1;
    const step = width / (values.length - 1);
    const points = values.map((v, i) => `${i * step},${height - ((v - min) / range) * height}`).join(' ');
    const svg = svgEl('svg', { width, height, viewBox: `0 0 ${width} ${height}` });
    svg.appendChild(svgEl('polyline', {
      points, fill: 'none', stroke: options.color || PALETTE.primary, 'stroke-width': 2,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    }));
    container.appendChild(svg);
  }

  return { PALETTE, horizontalBarList, donutChart, columnChart, sparkline };
})();
