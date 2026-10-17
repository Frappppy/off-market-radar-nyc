// Print the geometry-sample timeline for one viewport of a raw CLS file.
// Usage: node timeline.js <raw/cls-<route>.json> <viewport>
const fs = require('fs');
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const vp = process.argv[3];
const d = data[vp];
if (!d) { console.log('no such viewport: ' + Object.keys(data).join(',')); process.exit(1); }
console.log(`# ${vp}  clsRaw=${d.clsRaw} docH=${d.docH} fcp=${d.fcp}`);
for (const sm of d.samples) {
  console.log(`\nt=${sm.t}ms  doc=[${sm.doc}]`);
  for (const k of Object.keys(sm.changed)) {
    console.log(`   ${JSON.stringify(sm.changed[k])}  ${k}`);
  }
}
