// 12-cell (4 routes x 3 viewports) CLS + console + network, against the LOCAL
// production build. Same harness the diagnosis/fix used:
//   viewport via CDP Emulation.setDeviceMetricsOverride {mobile:false, dsf:1}
//   touch emulation explicitly disabled
//   instrument via addInitScript(cls-init.js) -> window.__LS
const fs = require("fs");
const path = require("path");
const { launch, cell, BASE, INSTR, OUT, writeJson } = require("./lib");

const TAG = process.env.TAG || "after";
const ROUTES = ["/", "/map", "/data", "/trends"];
const VIEWS = [
  [390, 844],
  [1280, 900],
  [1350, 940],
];
const SETTLE = 15000;

const cut = (shifts, ms) =>
  Number(shifts.filter((s) => s.t <= ms).reduce((a, s) => a + s.value, 0).toFixed(6));

(async () => {
  const browser = await launch();
  const results = [];
  for (const route of ROUTES) {
    for (const [w, h] of VIEWS) {
      const c = await cell(browser, route, w, h, { settle: 0, init: INSTR });
      await c.page.waitForTimeout(SETTLE);
      const probe = await c.page.evaluate(() => {
        const S = window.__LS || {};
        const sh = S.shifts || [];
        return {
          iw: window.innerWidth,
          ih: window.innerHeight,
          dpr: window.devicePixelRatio,
          maxTouchPoints: navigator.maxTouchPoints,
          clsRaw: S.clsRaw,
          clsFiltered: S.clsFiltered,
          shiftCount: sh.length,
          shiftsWithInput: sh.filter((s) => s.hadRecentInput).length,
          inputs: (S.inputs || []).length,
          shifts: sh,
          largest: [...sh].sort((a, b) => b.value - a.value).slice(0, 3),
          h1: document.querySelectorAll("h1").length,
          hScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
        };
      });
      const rec = {
        tag: TAG,
        route,
        width: w,
        height: h,
        ...probe,
        series: {
          t1000: cut(probe.shifts, 1000),
          t3000: cut(probe.shifts, 3000),
          t5000: cut(probe.shifts, 5000),
          t10000: cut(probe.shifts, 10000),
          tEnd: cut(probe.shifts, 1e9),
        },
        consoleErrors: c.errs,
        netFailed: c.failed,
        net4xx: c.bad,
      };
      results.push(rec);
      console.log(
        `CLS ${TAG} ${route} ${w}x${h} raw=${rec.clsRaw} filtered=${rec.clsFiltered} shifts=${rec.shiftCount} hri=${rec.shiftsWithInput} inputs=${rec.inputs} iw=${rec.iw} err=${rec.consoleErrors.length} 4xx=${rec.net4xx.length} fail=${rec.netFailed.length} hscroll=${rec.hScroll}`
      );
      await c.ctx.close();
      writeJson(path.join(OUT, `cls-${TAG}.json`), results);
    }
  }
  await browser.close();
  console.log("CLS DONE " + TAG);
})();
