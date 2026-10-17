// Analyse raw CLS JSON produced by extract.ps1.
// Usage: node report.js <raw/cls-<route>.json> [--samples] [--mutations]
const fs = require('fs');
const file = process.argv[2];
const showSamples = process.argv.includes('--samples');
const showMutations = process.argv.includes('--mutations');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

const classify = (src) => {
  if (!src || !src.node) return 'unknown';
  const { prev, cur } = src;
  if (prev && prev.w === 0 && prev.h === 0) return 'inserted (was 0x0)';
  if (prev && cur && Math.abs(cur.h - prev.h) > 1) return cur.h > prev.h ? 'GROW above' : 'SHRINK above';
  if (prev && cur && Math.abs(cur.y - prev.y) > 1) return 'pushed down/up';
  if (prev && cur && Math.abs(cur.w - prev.w) > 1) return 'width change';
  return 'other';
};

for (const vp of Object.keys(data)) {
  const d = data[vp];
  console.log('='.repeat(100));
  console.log(`VIEWPORT ${vp}  (innerW=${d.innerW} docH=${d.docH} fcp=${d.fcp} lcp=${d.lcp} fontsReady=${d.fontsReady})`);
  console.log(`CLS raw=${d.clsRaw}  filtered(!hadRecentInput)=${d.clsFiltered}  shifts=${d.shiftCount}  realInputEvents=${(d.inputs || []).length}`);
  console.log('-'.repeat(100));
  for (const s of d.shifts) {
    console.log(`t=${s.t}ms  value=${s.value}  hadRecentInput=${s.hadRecentInput}  lastInputTime=${s.lastInputTime}  sources=${s.sources.length}`);
    for (const src of s.sources) {
      const n = src.node || {};
      const prev = src.prev, cur = src.cur;
      const dy = prev && cur ? cur.y - prev.y : null;
      const dh = prev && cur ? cur.h - prev.h : null;
      const dx = prev && cur ? cur.x - prev.x : null;
      console.log(`    [${classify(src)}] dy=${dy} dh=${dh} dx=${dx}`);
      console.log(`      prev y=${prev ? prev.y : '-'} h=${prev ? prev.h : '-'} w=${prev ? prev.w : '-'}  ->  cur y=${cur ? cur.y : '-'} h=${cur ? cur.h : '-'} w=${cur ? cur.w : '-'}`);
      console.log(`      node: ${n.path || (n.textNode ? '[text]' : '[unknown]')}`);
      console.log(`      cls="${(n.cls || '').slice(0, 90)}"  text="${(n.snippet || n.text || '').slice(0, 80)}"`);
    }
  }
  if (showSamples) {
    console.log('-'.repeat(100));
    console.log('GEOMETRY SAMPLES (only frames where a tracked element changed):');
    for (const sm of d.samples) {
      console.log(`  t=${sm.t}ms doc=[${sm.doc}]`);
      for (const k of Object.keys(sm.changed)) {
        console.log(`     ${k} = y/h/w ${JSON.stringify(sm.changed[k])}`);
      }
    }
  }
  if (showMutations) {
    console.log('-'.repeat(100));
    console.log('MUTATIONS:');
    for (const m of d.mutations) {
      console.log(`  t=${m.t} ${m.type} target=${m.target} attr=${m.attr} +${m.addedN} -${m.removedN} added=${JSON.stringify(m.added)}`);
    }
  }
}
