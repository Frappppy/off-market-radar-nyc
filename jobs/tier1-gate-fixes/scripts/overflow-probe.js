// Which element is wider than the viewport? Walks every element and reports the
// real box overflow (right - innerWidth), worst first — attribution for the
// hscroll=true on /trends@390 (scrollWidth 491 vs innerWidth 390).
const { launch, cell, INSTR, OUT, writeJson } = require("./lib");

(async () => {
  const ROUTE = process.env.ROUTE || "/trends";
  const W = Number(process.env.W || 390);
  const H = Number(process.env.H || 844);
  const TAG = process.env.TAG || "probe";

  const browser = await launch();
  const c = await cell(browser, ROUTE, W, H, { settle: 0, init: INSTR });
  await c.page.waitForTimeout(Number(process.env.SETTLE || 15000));
  const p = await c.page.evaluate(() => {
    const iw = window.innerWidth;
    const out = [];
    document.querySelectorAll("*").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const over = Math.round(r.right - iw);
      if (over > 1) {
        out.push({
          over,
          tag: el.tagName.toLowerCase(),
          cls: String(el.className || "").slice(0, 80),
          right: Math.round(r.right),
          w: Math.round(r.width),
          scrollW: el.scrollWidth,
          overflowX: getComputedStyle(el).overflowX,
          text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 48),
        });
      }
    });
    out.sort((a, b) => b.over - a.over);
    return {
      iw,
      ih: window.innerHeight,
      docScrollW: document.documentElement.scrollWidth,
      bodyScrollW: document.body.scrollWidth,
      offenders: out.length,
      worst: out.slice(0, 14),
    };
  });
  console.log(`OVERFLOW ${TAG} ${ROUTE}@${W}: iw=${p.iw} docScrollW=${p.docScrollW} offenders=${p.offenders}`);
  for (const o of p.worst) {
    console.log(
      `  +${String(o.over).padStart(4)}px  <${o.tag} class="${o.cls}"> w=${o.w} right=${o.right} scrollW=${o.scrollW} overflowX=${o.overflowX} :: ${JSON.stringify(o.text)}`
    );
  }
  writeJson(`${OUT}\\overflow-${TAG}.json`, p);
  await browser.close();
})();
