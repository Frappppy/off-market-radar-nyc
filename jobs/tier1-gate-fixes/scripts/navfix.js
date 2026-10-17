// Verify the two nits the design-qa takeover surfaced, on a local build:
//   1. nav carries the filter: /data?score=High&min_dom=90 -> click "Trends"
//      must land on /trends?score=High&min_dom=90 and render 43, not 133.
//   2. no "In filter 0" claim while the first fetch is in flight: sample at
//      120/250/400ms and require the KPI to be "…" (loading), never "0".
const { launch, cell, BASE, OUT, writeJson } = require("./lib");

const readKpi = () => {
  const out = {};
  // The KPI <dt> renders uppercase via CSS, and innerText returns the TRANSFORMED
  // text ("IN FILTER"), so look up case-insensitively.
  document.querySelectorAll("dl dt").forEach((dt) => {
    const dd = dt.parentElement.querySelector("dd");
    out[dt.innerText.trim().toLowerCase()] = dd ? dd.innerText.trim() : null;
  });
  return out;
};

(async () => {
  const browser = await launch();
  const out = { base: BASE };
  const say = (s) => console.log(s);

  // ---- 1. nav carries the filter ----
  const c = await cell(browser, "/data?score=High&min_dom=90", 1280, 900, { settle: 7000, watchApi: true });
  const hrefs = await c.page.evaluate(() =>
    [...document.querySelectorAll("header nav a")].map((a) => a.getAttribute("href"))
  );
  say(`NAV hrefs on /data?score=High&min_dom=90: ${JSON.stringify(hrefs)}`);
  out.navHrefs = hrefs;
  out.navCarriesQuery = hrefs.some((h) => h && h.startsWith("/trends?") && h.includes("min_dom=90"));

  await c.page.click('header nav a[href^="/trends"]');
  await c.page.waitForTimeout(6000);
  const afterNav = await c.page.evaluate(() => ({
    url: location.pathname + location.search,
    kpi: (() => { const o = {}; document.querySelectorAll("dl dt").forEach((dt) => { const dd = dt.parentElement.querySelector("dd"); o[dt.innerText.trim()] = dd ? dd.innerText.trim() : null; }); return o; })(),
    api: performance.getEntriesByType("resource").filter((r) => r.name.includes("/api/deals")).map((r) => r.name.split("?")[1]),
  }));
  say(`NAV -> Trends: url=${afterNav.url} kpi=${JSON.stringify(afterNav.kpi)} api=${JSON.stringify(afterNav.api)}`);
  out.afterNav = afterNav;
  out.navFilterHolds = /\/trends\?/.test(afterNav.url) && Object.values(afterNav.kpi).includes("43");
  await c.ctx.close();

  // ---- 2. no "In filter 0" while loading ----
  const c2 = await cell(browser, "/trends", 1280, 900, { settle: 100, watchApi: true });
  const samples = [];
  for (const t of [120, 250, 400, 900, 2500]) {
    await c2.page.waitForTimeout(t - (samples[samples.length - 1]?.t ?? 0));
    const k = await c2.page.evaluate(readKpi);
    samples.push({ t, inFilter: k["in filter"] ?? null, kpi: k });
    say(`LOAD sample t=${t}ms In filter="${k["in filter"]}"`);
  }
  out.loadSamples = samples;
  out.sawZeroClaim = samples.some((s) => s.inFilter === "0");
  out.settledInFilter = samples[samples.length - 1].inFilter;
  say(`LOAD: sawZeroClaim=${out.sawZeroClaim} settled=${out.settledInFilter}`);
  // If a "0" persisted, attribute it: a failed fetch lands in the catch branch
  // (loaded=true, deals=[]) and renders a zero claim instead of an error.
  say(`LOAD cell api=${JSON.stringify(c2.api)} errs=${c2.errs.length} failed=${JSON.stringify(c2.failed)} 4xx=${JSON.stringify(c2.status4xx)}`);
  out.loadApi = c2.api;
  out.loadErrs = c2.errs;
  out.loadFailed = c2.failed;
  await c2.ctx.close();

  await browser.close();
  writeJson(`${OUT}\\navfix.json`, out);
  say(`VERDICT navCarriesQuery=${out.navCarriesQuery} navFilterHolds=${out.navFilterHolds} sawZeroClaim=${out.sawZeroClaim}`);
  say("NAVFIX DONE");
})();
