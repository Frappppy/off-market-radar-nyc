// Focused repeat measurement of a single cell, for attribution rather than a
// pass/fail sweep: does /trends@390 reproduce the 0.15293, and does the
// DEPLOYED build (which still runs the pre-gate-fix code) show the same number?
// Same harness as cls.js — CDP viewport, cls-init.js observer, JSON shifts.
//
//   BASE=http://localhost:3222  TAG=local390  node repeat-cell.js
//   $env:BASE="https://off-market-radar-nyc.vercel.app"; TAG=prod390 node repeat-cell.js
const { launch, cell, BASE, INSTR, OUT, writeJson } = require("./lib");

const ROUTE = process.env.ROUTE || "/trends";
const W = Number(process.env.W || 390);
const H = Number(process.env.H || 844);
const N = Number(process.env.N || 3);
const SETTLE = Number(process.env.SETTLE || 15000);
const TAG = process.env.TAG || "repeat-cell";

(async () => {
  const browser = await launch();
  const rows = [];
  for (let i = 1; i <= N; i++) {
    const c = await cell(browser, ROUTE, W, H, { settle: 0, init: INSTR });
    await c.page.waitForTimeout(SETTLE);
    const p = await c.page.evaluate(() => {
      const S = window.__LS || {};
      const sh = S.shifts || [];
      const doc = document.documentElement;
      return {
        clsRaw: S.clsRaw,
        clsFiltered: S.clsFiltered,
        shiftCount: sh.length,
        largest: [...sh].sort((a, b) => b.value - a.value).slice(0, 3),
        hScroll: doc.scrollWidth > window.innerWidth + 1,
        scrollWidth: doc.scrollWidth,
        innerWidth: window.innerWidth,
        h1Count: document.querySelectorAll("h1").length,
        tables: document.querySelectorAll("table").length,
        pinned: (document.body.innerText.match(/(\d+) of ([\d,]+) shown/) || [])[0] || null,
      };
    });
    rows.push({ run: i, base: BASE, ...p, errs: c.errs.length, net4xx: c.bad.length, netFailed: c.failed.length });
    console.log(
      `CELL ${TAG} ${BASE} ${ROUTE}@${W} run${i}: raw=${p.clsRaw} filtered=${p.clsFiltered} ` +
        `shifts=${p.shiftCount} hscroll=${p.hScroll} (scrollW=${p.scrollWidth} iw=${p.innerWidth}) ` +
        `err=${c.errs.length} 4xx=${c.bad.length} fail=${c.failed.length}`
    );
    for (const s of p.largest) {
      console.log(`    t=${s.t} value=${s.value} hri=${s.hadRecentInput} sources=${JSON.stringify(String(s.sources || "").slice(0, 120))}`);
    }
    await c.ctx.close();
  }
  writeJson(`${OUT}\\${TAG}.json`, rows);
  await browser.close();
  console.log("FOCUSED DONE " + TAG);
})();
