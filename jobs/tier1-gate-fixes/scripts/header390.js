// Measure the header reflow at 390: does /api/meta's arrival widen the
// Freshness box enough to wrap the flex header from 2 rows to 3?
// Captures: computed display of the detail span, wrapper width/rect before and
// after, logo width, and whether the nav's y actually moves.
const { launch, BASE, OUT, writeJson } = require("./lib");

const probe = () => {
  const wrap = document.querySelector("header div.order-2");
  const detail = wrap ? wrap.querySelector("span.hidden") : null;
  const nav = document.querySelector("header nav");
  const logo = document.querySelector("header a");
  const r = (el) => (el ? { x: Math.round(el.getBoundingClientRect().x), y: Math.round(el.getBoundingClientRect().y), w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) } : null);
  return {
    text: wrap ? wrap.innerText.replace(/\s+/g, " ").trim() : null,
    textLen: wrap ? wrap.innerText.replace(/\s+/g, " ").trim().length : null,
    detailDisplay: detail ? getComputedStyle(detail).display : "no-span",
    headerH: Math.round(document.querySelector("header").getBoundingClientRect().height),
    headerRows: document.querySelector("header .mx-auto").children.length,
    wrap: r(wrap),
    nav: r(nav),
    logo: r(logo),
    vw: window.innerWidth,
    containerInner: Math.round(document.querySelector("header .mx-auto").getBoundingClientRect().width - 32),
  };
};

(async () => {
  const browser = await launch();
  const out = { base: BASE, samples: [] };
  const say = (s) => console.log(s);

  const ctx = await browser.newContext({ viewport: null });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });

  await page.goto(BASE + "/data", { waitUntil: "load" });
  // Sample densely across the meta arrival window.
  for (const t of [150, 400, 900, 1600, 3000]) {
    await page.waitForTimeout(t - (out.samples[out.samples.length - 1]?.t ?? 0));
    const p = await page.evaluate(probe);
    out.samples.push({ t, ...p });
    say(`HDR t=${t}ms rows=${p.headerRows} headerH=${p.headerH} wrapW=${p.wrap && p.wrap.w} wrapY=${p.wrap && p.wrap.y} navY=${p.nav && p.nav.y} logoW=${p.logo && p.logo.w} detail=${p.detailDisplay} inner=${p.containerInner} textLen=${p.textLen} text="${(p.text || "").slice(0, 60)}"`);
  }
  say(`HDR vw=${out.samples[0].vw} containerInner=${out.samples[0].containerInner}`);
  say(`HDR sum(logo+gap+wrap)= ${out.samples[0].logo.w + 12 + (out.samples[out.samples.length - 1].wrap.w)} vs inner ${out.samples[0].containerInner}`);
  out.headerCarriesQuery = await page.evaluate(() => [...document.querySelectorAll("header nav a")].map((a) => a.getAttribute("href")));
  say(`HDR nav hrefs: ${JSON.stringify(out.headerCarriesQuery)}`);
  writeJson(`${OUT}\\header390.json`, out);
  await ctx.close();
  await browser.close();
  say("HDR DONE");
})();
