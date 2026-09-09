/**
 * ============================================================================
 * SSD.Icons — Inline-SVG-Icon-Set
 * ============================================================================
 * Statt eines externen Icon-Fonts/CDN werden alle Icons als schlanke Inline-
 * SVGs bereitgestellt (kein Netzwerkzugriff nötig, volle Farbkontrolle via
 * `currentColor`, keine Layout-Sprünge durch Web-Font-Nachladen).
 */
window.SSD = window.SSD || {};

SSD.Icons = (function () {
  'use strict';

  const paths = {
    dashboard: '<path d="M4 4h7v9H4z"/><path d="M13 4h7v5h-7z"/><path d="M13 11h7v9h-7z"/><path d="M4 15h7v5H4z"/>',
    students: '<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c0-3.6 2.9-6.2 6.5-6.2s6.5 2.6 6.5 6.2"/><circle cx="17.5" cy="8.5" r="2.6"/><path d="M15.8 13.9c2.7.4 4.7 2.5 4.7 5.6"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
    settings: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 13.5a7.6 7.6 0 000-3l2-1.6-2-3.4-2.4.7a7.7 7.7 0 00-2.6-1.5L14 2h-4l-.4 2.7a7.7 7.7 0 00-2.6 1.5l-2.4-.7-2 3.4 2 1.6a7.6 7.6 0 000 3l-2 1.6 2 3.4 2.4-.7a7.7 7.7 0 002.6 1.5L10 22h4l.4-2.7a7.7 7.7 0 002.6-1.5l2.4.7 2-3.4-2-1.6z"/>',
    schedule: '<rect x="3.5" y="4" width="17" height="16.5" rx="2.5"/><path d="M3.5 9.5h17M8 4v3M16 4v3"/><path d="M7.5 13.2h3.2v2.6H7.5zM13.3 13.2h3.2v2.6h-3.2z"/>',
    stats: '<path d="M4 20V10M11 20V4M18 20v-7"/><path d="M2.5 20.5h19"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.8-4.8"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="M4 16.5V20h3.5L18.5 9 15 5.5 4 16.5z"/><path d="M13.5 7 17 10.5"/>',
    trash: '<path d="M4.5 7h15M9.5 7V5a1.5 1.5 0 011.5-1.5h2A1.5 1.5 0 0114.5 5v2M6.5 7l1 12.5A2 2 0 009.5 21.5h5a2 2 0 002-2L17.5 7"/>',
    check: '<path d="M4.5 12.5l5 5 10-11"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    chevronDown: '<path d="M6 9l6 6 6-6"/>',
    chevronRight: '<path d="M9 6l6 6-6 6"/>',
    chevronLeft: '<path d="M15 6l-6 6 6 6"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    logout: '<path d="M9 8V6a2 2 0 012-2h6a2 2 0 012 2v12a2 2 0 01-2 2h-6a2 2 0 01-2-2v-2"/><path d="M13 12H3m0 0l3.5-3.5M3 12l3.5 3.5"/>',
    sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.4M12 19.1v2.4M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.6 19.4l1.7-1.7M17.7 6.3l1.7-1.7"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z"/>',
    bell: '<path d="M6 9a6 6 0 1112 0c0 4.5 1.5 6 2 7H4c.5-1 2-2.5 2-7z"/><path d="M10 19a2 2 0 004 0"/>',
    sparkles: '<path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    wand: '<path d="M4 20L16 8"/><path d="M14 3l1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/><path d="M18.5 10.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z"/>',
    download: '<path d="M12 3v13m0 0l-4.5-4.5M12 16l4.5-4.5"/><path d="M4 19.5h16"/>',
    upload: '<path d="M12 21V8m0 0l-4.5 4.5M12 8l4.5 4.5"/><path d="M4 19.5h16"/>',
    print: '<path d="M7 8.5V4h10v4.5"/><rect x="4.5" y="8.5" width="15" height="7.5" rx="1.5"/><path d="M7 14.5h10v6H7z"/>',
    filter: '<path d="M4 5h16l-6 7.5V19l-4 2v-8.5z"/>',
    warning: '<path d="M12 4.5L2.5 20h19z"/><path d="M12 10v4.2M12 17.2v.1"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.1"/>',
    lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V7.5a4 4 0 018 0v3"/>',
    unlock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V7.5a4 4 0 017.8-1.3"/>',
    user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M4.5 20c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5"/>',
    shield: '<path d="M12 3l7 3v5.5c0 4.5-3 7.5-7 9.5-4-2-7-5-7-9.5V6z"/>',
    undo: '<path d="M7 11H17a4.5 4.5 0 010 9h-2"/><path d="M11 6.5L6.5 11 11 15.5"/>',
    redo: '<path d="M17 11H7a4.5 4.5 0 000 9h2"/><path d="M13 6.5L17.5 11 13 15.5"/>',
    refresh: '<path d="M20 11A8 8 0 105.5 16.5"/><path d="M20 5v6h-6"/>',
    arrowRight: '<path d="M4 12h16M14 6l6 6-6 6"/>',
    save: '<path d="M5 4.5h11L19.5 9v10.5h-15z"/><path d="M8 4.5V10h7V4.5M8 19.5V14h8v5.5"/>',
    dots: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
    grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
    female: '<circle cx="12" cy="8" r="5"/><path d="M12 13v8M8.5 18h7"/>',
    male: '<circle cx="10" cy="14" r="5"/><path d="M14 10l6-6M14 4h6v6"/>',
    trophy: '<path d="M7 4h10v5a5 5 0 01-10 0z"/><path d="M5 6H3.5a2 2 0 000 4H5M19 6h1.5a2 2 0 010 4H19"/><path d="M9 19.5h6M12 14v5.5"/>',
    fileCsv: '<path d="M6 3.5h9L19 8v12.5H6z"/><path d="M15 3.5V8h4"/><path d="M8.5 15.2c-.9 0-1.5.7-1.5 1.6s.6 1.6 1.5 1.6"/><path d="M12 15.2h-.8c-.6 0-1 .4-1 .9 0 .8 1.8.5 1.8 1.3 0 .5-.4.9-1 .9H10"/><path d="M14.3 15.2l1 3.3 1-3.3"/>',
    fileExcel: '<path d="M6 3.5h9L19 8v12.5H6z"/><path d="M15 3.5V8h4"/><path d="M9 15l3.5 4.2M12.5 15L9 19.2"/>',
    filePdf: '<path d="M6 3.5h9L19 8v12.5H6z"/><path d="M15 3.5V8h4"/><path d="M8 19v-4h1.3a1.3 1.3 0 010 2.6H8"/><path d="M12.2 19v-4h1a2 2 0 010 4h-1z"/><path d="M17 15h-1.6v4M15.4 17h1.3"/>',
    fileJson: '<path d="M6 3.5h9L19 8v12.5H6z"/><path d="M15 3.5V8h4"/><path d="M9 15c-.8 0-1.1.4-1.1 1s.4.9 1.1 1.1c.7.2 1.1.5 1.1 1.1s-.3 1-1.1 1"/><path d="M15 15c.8 0 1.1.4 1.1 1s-.4.9-1.1 1.1c-.7.2-1.1.5-1.1 1.1s.3 1 1.1 1"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9"/>',
    xCircle: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.5l3.5 2"/>',
    swap: '<path d="M17 4l3.5 3.5L17 11"/><path d="M20.5 7.5H8A4 4 0 004 11.5"/><path d="M7 20l-3.5-3.5L7 13"/><path d="M3.5 16.5H16a4 4 0 004-4"/>',
    key: '<circle cx="8" cy="15" r="3.2"/><path d="M10.2 12.8L18 5M15.5 7.5L18 5l2 2-2.3 2.3M13.2 10.1l2 2"/>',
    building: '<path d="M4 20.5V4.5h9v16M13 9h6.5v11.5H13"/><path d="M7 8h2M7 12h2M7 16h2M15.5 12.5h2M15.5 16h2"/>',
    zap: '<path d="M13 3L5 13.5h5.5L11 21l8-11h-6z"/>',
    heart: '<path d="M12 20s-7.5-4.6-9.5-9.3C1.2 7 3 4 6.5 4c2 0 3.5 1.2 4.5 2.7C12 5.2 13.5 4 15.5 4 19 4 20.8 7 19.5 10.7 17.5 15.4 12 20 12 20z"/>',
    puzzle: '<path d="M9 4.5h4V7a1.7 1.7 0 003.4 0V4.5H19v4.9h-2.5a1.7 1.7 0 000 3.4H19V18h-4.9v-2.5a1.7 1.7 0 00-3.4 0V18H4v-4.6h2.5a1.7 1.7 0 000-3.4H4V5.8"/>',
    userAbsent: '<circle cx="9.5" cy="7.5" r="3.5"/><path d="M3 20c0-3.6 2.9-6.2 6.5-6.2 1.4 0 2.7.4 3.8 1.1"/><path d="M15.5 15l5 5M20.5 15l-5 5"/>',
    userSearch: '<circle cx="9" cy="8" r="3.3"/><path d="M2.5 20c0-3.6 2.9-6.1 6.5-6.1 1 0 2 .2 2.8.6"/><circle cx="17" cy="16.5" r="3"/><path d="M19.3 18.8L21.5 21"/>',
    flag: '<path d="M5 3v18"/><path d="M5 4.5h13l-3 4 3 4H5"/>',
    handRaised: '<path d="M9 12.5V5a1.5 1.5 0 013 0v6M12 11V4a1.5 1.5 0 013 0v7M15 11.5V6a1.5 1.5 0 013 0v9c0 4-2.5 7-6.5 7-2.8 0-4.3-1-5.8-3l-2.8-4.5a1.4 1.4 0 012.3-1.6L7 15.5V6a1.5 1.5 0 013 0v6.5"/>',
    star: '<path d="M12 3.5l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6-4.4-4.2 6-.8z"/>',
  };

  /**
   * Erstellt einen SVG-Icon-String.
   * @param {keyof typeof paths} name
   * @param {{size?: number, strokeWidth?: number, className?: string}} [opts]
   */
  function svg(name, opts = {}) {
    const size = opts.size || 20;
    const strokeWidth = opts.strokeWidth || 1.8;
    const body = paths[name];
    if (!body) return '';
    return `<svg xmlns="http://www.w3.org/2000/svg" class="${opts.className || ''}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  }

  return { svg, names: Object.keys(paths) };
})();
