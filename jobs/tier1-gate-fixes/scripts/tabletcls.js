// Attribution probe for the tablet-width CLS that frozencls.js surfaced at
// 640/768 (0.31 live / 0.51 frozen). Dumps every shift's resolved sources with
// rects and text, so the movement is named rather than guessed. Run twice —
// BASE=http://localhost:3222 (with the F6 fix) and BASE=<deployed alias>
// (pre-fix build) — to decide whether F6 caused it or merely exposed it.
const { launch, BASE, OUT, INSTR, writeJson } = require("./lib");

const probe = () => {
  try {
    const L = window.__LS || {};
    const r = (x) =>
      x && typeof x === "object"
        ? { x: Math.round(x.x || 0), y: Math.round(x.y || 0), w: Math.round(x.width || 0), h: Math.round(x.height || 0) }
        : null;
    const header = document.querySelector("header");
    const wrap = document.querySelector("header div.order-2");
    return {
      vw: window.innerWidth,
      vh: window.innerHeight,
      headerH: header ? Math.round(header.getBoundingClientRect().height) : null,
      headerRows: document.querySelector("header .mx-auto")
        ? document.querySelector("header .mx-auto").children.length
        : null,
      wrapW: wrap ? Math.round(wrap.getBoundingClientRect().width) : null,
      wrapText: wrap ? wrap.innerText.replace(/\s+/g, " ").slice(0, 70) : null,
      docH: document.body ? document.body.scrollHeight : null,
      clsRaw: L.clsRaw,
      fcp: L.fcp,
      shifts: (L.shifts || []).map((s) => ({
        t: s.t,
        value: s.value,
        hri: s.hadRecentInput,
        sources: (s.sources || []).map((src) => ({
          prev: src && src.prev ? r(src.prev) : null,
          cur: src && src.cur ? r(src.cur) : null,
          path: src && src.node ? src.node.path : null,
          text: src && src.node && src.node.text ? String(src.node.text).slice(0, 70) : null,
        })),
      })),
    };
  } catch (e) {
    return { probeError: String(e).slice(0, 200), shifts: [], clsRaw: null };
  }
};

(async () => {
  const browser = await launch();
  const out = { base: BASE, cells: [] };
  const say = (s) => console.log(s);

  for (const w of [640, 768]) {
    const ctx = await browser.newContext({ viewport: null });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.addInitScript({ path: INSTR });
    await page.goto(BASE + "/data", { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(3500);
    const p = await page.evaluate(probe);
    out.cells.push({ w, ...p });
    say(`TAB w=${w} cls=${(p.clsRaw ?? 0).toFixed(5)} headerH=${p.headerH} rows=${p.headerRows} wrapW=${p.wrapW} docH=${p.docH} fcp=${p.fcp}`);
    for (const s of p.shifts) {
      say(`  SHIFT t=${s.t} value=${s.value}`);
      for (const src of s.sources) {
        say(`    ${JSON.stringify(src.prev)} -> ${JSON.stringify(src.cur)} ${src.path} "${src.text}"`);
      }
    }
    await ctx.close();
  }

  writeJson(`${OUT}\\tabletcls.json`, out);
  await browser.close();
  say("TAB DONE");
})();
