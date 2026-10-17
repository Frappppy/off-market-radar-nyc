// Generate concrete probe runners from _probe_template.js
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const tpl = fs.readFileSync(path.join(dir, '_probe_template.js'), 'utf8');

const trendsProbes = [
  { k: 'h1block', sel: 'main > div.space-y-4 > div.flex.flex-wrap.items-start' },
  { k: 'h1copy', sel: 'main > div.space-y-4 > div.flex.flex-wrap.items-start > div.min-w-0 > p.mt-1', text: 130 },
  { k: 'sharelink', sel: 'main > div.space-y-4 > div.flex.flex-wrap.items-start > div.ml-auto' },
  { k: 'kpidl', sel: 'main > div.space-y-4 > dl.grid' },
  { k: 'kpicells', sel: 'main > div.space-y-4 > dl.grid > div', max: 8 },
  { k: 'health', sel: 'main > div.space-y-4 > section.panel.p-3' },
  { k: 'healthHead', sel: 'main > div.space-y-4 > section.panel.p-3 > div.flex.flex-wrap' },
  { k: 'healthDl', sel: 'main > div.space-y-4 > section.panel.p-3 > dl' },
  { k: 'healthCells', sel: 'main > div.space-y-4 > section.panel.p-3 > dl > div', max: 6 },
  { k: 'healthVal', sel: 'main > div.space-y-4 > section.panel.p-3 > dl > div > dd.truncate', max: 6, text: 40 },
  { k: 'healthNote', sel: 'main > div.space-y-4 > section.panel.p-3 > dl > div > dd.line-clamp-2', max: 6, text: 60 },
  { k: 'healthFoot', sel: 'main > div.space-y-4 > section.panel.p-3 > p' },
  { k: 'charts', sel: 'main > div.space-y-4 > div.grid.gap-3' },
  { k: 'topTable', sel: 'main > div.space-y-4 > section.panel.p-4' },
  { k: 'footer', sel: 'footer' },
  { k: 'main', sel: 'main' },
];

const rootProbes = [
  { k: 'hero', sel: 'main > div.space-y-4 > section.panel' },
  { k: 'eyebrow', sel: 'main > div.space-y-4 > section.panel > p.eyebrow', text: 60 },
  { k: 'h1', sel: 'main > div.space-y-4 > section.panel > h1', text: 90 },
  { k: 'intro', sel: 'main > div.space-y-4 > section.panel > p.mt-3', text: 90 },
  { k: 'scope', sel: 'main > div.space-y-4 > section.panel > p.mt-2', text: 90 },
  { k: 'ctas', sel: 'main > div.space-y-4 > section.panel > div.mt-4' },
  { k: 'kpidl', sel: 'main > div.space-y-4 > section.panel > dl' },
  { k: 'kpicells', sel: 'main > div.space-y-4 > section.panel > dl > div', max: 8 },
  { k: 'kpival', sel: 'main > div.space-y-4 > section.panel > dl > div > dd', max: 12, text: 30 },
  { k: 'explorer', sel: 'main > div.space-y-4 > div.space-y-3' },
  { k: 'fallback', sel: 'main > div.space-y-4 > p.text-sm', text: 40 },
  { k: 'toolbar', sel: 'main > div.space-y-4 > div.space-y-3 > div.panel' },
  { k: 'showcount', sel: 'main > div.space-y-4 > div.space-y-3 > div.panel > span.text-xs', max: 3, text: 40 },
  { k: 'map', sel: 'main > div.space-y-4 > div.space-y-3 > div.overflow-hidden' },
  { k: 'insights', sel: 'main > div.space-y-4 > section.grid' },
  { k: 'footer', sel: 'footer' },
  { k: 'main', sel: 'main' },
];

const mapProbes = [
  { k: 'head', sel: 'main > div.space-y-3 > div.flex.flex-wrap.items-end' },
  { k: 'shown', sel: 'main > div.space-y-3 > div.flex.flex-wrap.items-end > p.ml-auto', text: 60 },
  { k: 'grid', sel: 'main > div.space-y-3 > div.grid' },
  { k: 'aside', sel: 'main > div.space-y-3 > div.grid > div.lg\\:sticky > aside' },
  { k: 'mapwrap', sel: 'main > div.space-y-3 > div.grid > div.relative > div.overflow-hidden' },
  { k: 'footer', sel: 'footer' },
  { k: 'main', sel: 'main' },
];

const build = (name, route, w, h, probes) => {
  const out = tpl
    .split('__ROUTE__').join(route)
    .split('__VP__').join(`${w}x${h}`)
    .split('__W__').join(String(w))
    .split('__H__').join(String(h))
    .split('__PROBES__').join(JSON.stringify(probes));
  fs.writeFileSync(path.join(dir, name), out);
  console.log('wrote ' + name + ' ' + out.length + ' bytes');
};

build('probe-trends-390.js', '/trends', 390, 844, trendsProbes);
build('probe-trends-1350.js', '/trends', 1350, 940, trendsProbes);
build('probe-root-390.js', '/', 390, 844, rootProbes);
build('probe-root-1350.js', '/', 1350, 940, rootProbes);
build('probe-map-390.js', '/map', 390, 844, mapProbes);
