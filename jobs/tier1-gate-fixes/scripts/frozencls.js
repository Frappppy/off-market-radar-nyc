// F6 — the intermittent /data@390 = 0.1466 CLS breach, reproduced and retested.
//
// Mechanism: when /api/meta falls back to the bundled sample, `live:false`
// makes Freshness render a "frozen fallback" pill. At 390 the header's first
// row has 135px for that box (390 - 211px logo - 12px gap) and the date alone
// is 118px, so the pill wrapped the flex row onto a THIRD header line and
// pushed <main> down 28px.
//
// This script forces the frozen path by intercepting /api/meta, measures the
// real CLS with the gate's own instrumentation, and compares the header's
// geometry against the same cell in the LIVE state. Passing requires the
// header height to be identical in both states at every width.
const { launch, cell, BASE, OUT, INSTR, writeJson } = require("./lib");

const FROZEN_META = {
  snapshot_date: "2026-10-15",
  records_loaded: 82,
  source: "zillow",
  run_id: "20261015-055515",
  live: false,
  total_tracked: 82,
  high_count: 2,
};

const probe = () => {
  const header = document.querySelector("header");
  const row = document.querySelector("header .mx-auto");
  const wrap = document.querySelector("header div.order-2");
  const nav = document.querySelector("header nav");
  const r = (el) =>
    el
      ? {
          x: Math.round(el.getBoundingClientRect().x),
          y: Math.round(el.getBoundingClientRect().y),
          w: Math.round(el.getBoundingClientRect().width),
          h: Math.round(el.getBoundingClientRect().height),
        }
      : null;
  const L = window.__LS || {};
  const txt = wrap ? wrap.innerText.replace(/\s+/g, " ").trim() : null;
  return {
    headerH: Math.round(header.getBoundingClientRect().height),
    rows: row.children.length,
    wrap: r(wrap),
    nav: r(nav),
    wrapText: txt,
    hasCompactPill: /Frozen ·/.test(txt || ""),
    hasFullPill: /frozen fallback/.test(txt || ""),
    clsRaw: L.clsRaw,
    shiftCount: (L.shifts || []).length,
    bigShifts: (L.shifts || [])
      .filter((s) => s.value > 0.01)
      .map((s) => ({
        value: s.value,
        t: s.t,
        nodes: (s.sources || [])
          .map((x) => (x.node ? x.node.path : ""))
          .join(" | ")
          .slice(0, 160),
      })),
  };
};

const runCell = async (browser, w, h, frozen) => {
  const ctx = await browser.newContext({ viewport: null });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: w,
    height: h,
    deviceScaleFactor: 1,
    mobile: false,
  });
  if (frozen) {
    await page.route("**/api/meta*", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", json: FROZEN_META })
    );
  }
  await page.addInitScript({ path: INSTR });
  await page.goto(BASE + "/data", { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(3500);
  const p = await page.evaluate(probe);
  await ctx.close();
  return p;
};

(async () => {
  const browser = await launch();
  const out = { base: BASE, cells: [] };
  const say = (s) => console.log(s);
  const widths = [390, 640, 768, 1280];

  for (const w of widths) {
    const live = await runCell(browser, w, 900, false);
    const frz = await runCell(browser, w, 900, true);
    const stable = live.headerH === frz.headerH;
    out.cells.push({ w, live, frozen: frz, headerHeightStable: stable });
    say(
      `FROZEN w=${w} liveH=${live.headerH} frozenH=${frz.headerH} stable=${stable} ` +
        `clsLive=${(live.clsRaw ?? 0).toFixed(5)} clsFrozen=${(frz.clsRaw ?? 0).toFixed(5)} ` +
        `shifts=${frz.shiftCount}`
    );
    say(
      `  frozen text="${(frz.wrapText || "").slice(0, 64)}" compact=${frz.hasCompactPill} full=${frz.hasFullPill} wrapW=${frz.wrap && frz.wrap.w}`
    );
    if (frz.bigShifts.length) say(`  big shifts: ${JSON.stringify(frz.bigShifts)}`);
  }

  out.verdict = {
    allStable: out.cells.every((c) => c.headerHeightStable),
    worstFrozenCls: Math.max(...out.cells.map((c) => c.frozen.clsRaw ?? 0)),
    anyOverBudget: out.cells.some((c) => (c.frozen.clsRaw ?? 0) > 0.1),
    compactPillBelowSm: out.cells.find((c) => c.w === 390).frozen.hasCompactPill,
    fullPillAtSm: out.cells.find((c) => c.w === 1280).frozen.hasFullPill,
  };
  say(`VERDICT ${JSON.stringify(out.verdict)}`);
  writeJson(`${OUT}\\frozencls.json`, out);
  await browser.close();
  say("FROZEN DONE");
})();
