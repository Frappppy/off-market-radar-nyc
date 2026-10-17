// Decisive check for one contradictory reading: the pins probe reports
// docWidth=411 at /map@390 while the CLS probe reports hscroll=false at the same
// cell. Which is right, and which element (if any) makes the document wider than
// the viewport? We measure the document's scroll width, whether the window can
// actually scroll horizontally, and name the widest visible elements.
const { launch, cell, BASE, OUT, writeJson } = require("./lib");

(async () => {
  const browser = await launch();
  const out = { base: BASE, cells: [] };
  const say = (s) => console.log(s);

  for (const w of [390, 768, 1280]) {
    for (const route of ["/map", "/trends", "/data"]) {
      const c = await cell(browser, route, w, w === 390 ? 844 : 900, { settle: 12000, watchApi: true });
      const r = await c.page.evaluate(() => {
        const de = document.documentElement;
        const x0 = window.scrollX;
        window.scrollTo(9999, 0);
        const moved = window.scrollX;
        window.scrollTo(x0, 0);
        const widest = [...document.querySelectorAll("body *")]
          .map((el) => {
            const b = el.getBoundingClientRect();
            const cn = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 3).join(".") : "";
            return { sel: el.tagName.toLowerCase() + (cn ? "." + cn : ""), right: Math.round(b.right), width: Math.round(b.width), visible: b.width > 0 && b.height > 0 && getComputedStyle(el).visibility !== "hidden" };
          })
          .filter((e) => e.visible && e.right > window.innerWidth + 1)
          .sort((a, b) => b.right - a.right)
          .slice(0, 6);
        return { inner: window.innerWidth, deScroll: de.scrollWidth, bodyScroll: document.body.scrollWidth, canScrollX: moved, widest };
      });
      say(`SCROLL ${route}@${w}: inner=${r.inner} deScroll=${r.deScroll} bodyScroll=${r.bodyScroll} canScrollX=${r.canScrollX} overflowing=${r.widest.length} api=${c.api.length} errs=${c.errs.length}`);
      r.widest.forEach((e) => say(`    ${e.sel} right=${e.right} w=${e.width}`));
      out.cells.push({ route, width: w, ...r, apiCalls: c.api.length, errs: c.errs.length });
      await c.ctx.close();
    }
  }
  writeJson(`${OUT}\\scrollprobe.json`, out);
  await browser.close();
  say("SCROLL DONE");
})();
