// Row composition of the header at each width, so the tablet fix is chosen
// from measured space rather than a guessed cap. Reports each flex item's
// width and y (items sharing a y are on the same row) plus the space left for
// Freshness on the logo row.
const { launch, BASE, OUT, writeJson } = require("./lib");

const geo = () => {
  const inner = document.querySelector("header .mx-auto");
  const items = [...inner.children].map((el) => {
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      cls: (el.className || "").toString().slice(0, 46),
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
      text: (el.innerText || "").replace(/\s+/g, " ").slice(0, 40),
    };
  });
  const ir = inner.getBoundingClientRect();
  const rowYs = [...new Set(items.map((i) => i.y))];
  // Space remaining on the topmost row (where the logo lives), after the logo
  // and anything else already sharing that row.
  const topY = Math.min(...rowYs);
  const onTop = items.filter((i) => i.y === topY);
  const used = onTop.reduce((a, i) => a + i.w, 0);
  const gaps = (onTop.length - 1) * 12;
  return {
    vw: window.innerWidth,
    innerW: Math.round(ir.width) - 32,
    rows: rowYs.length,
    headerH: Math.round(document.querySelector("header").getBoundingClientRect().height),
    items,
    topRowItems: onTop.length,
    spaceLeftForFreshness: Math.round(ir.width) - 32 - used - gaps,
    headerH_whenLoaded: null,
  };
};

(async () => {
  const browser = await launch();
  const out = { base: BASE, widths: [] };
  const say = (s) => console.log(s);
  const widths = [390, 500, 640, 700, 768, 900, 1024, 1280];

  for (const w of widths) {
    const ctx = await browser.newContext({ viewport: null });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.goto(BASE + "/data", { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(2500);
    const g = await page.evaluate(geo);
    out.widths.push(g);
    const logo = g.items.find((i) => /OFF-MARKET/.test(i.text));
    const nav = g.items.find((i) => i.tag === "nav");
    const fresh = g.items.find((i) => /order-2/.test(i.cls));
    say(
      `GEO w=${w} inner=${g.innerW} rows=${g.rows} headerH=${g.headerH} ` +
        `logo=${logo && logo.w}@y${logo && logo.y} nav=${nav && nav.w}@y${nav && nav.y} fresh=${fresh && fresh.w}@y${fresh && fresh.y} ` +
        `spaceLeft=${g.spaceLeftForFreshness}`
    );
    await ctx.close();
  }

  writeJson(`${OUT}\\rowgeo.json`, out);
  await browser.close();
  say("GEO DONE");
})();
