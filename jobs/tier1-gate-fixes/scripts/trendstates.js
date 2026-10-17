// Three-state proof for the /trends KPI and chart summaries. The first two
// states existed before; the THIRD is the one my own `loaded` fix got wrong:
// turning a failed fetch into "In filter 0 listings shown", a false claim in
// the other direction. Intercept /api/deals and abort it, then require the
// error rendering instead of a zero.
const { launch, BASE, OUT, writeJson } = require("./lib");

const readAll = () => {
  const kpi = {};
  document.querySelectorAll("dl dt").forEach((dt) => {
    const dd = dt.parentElement.querySelector("dd");
    kpi[dt.innerText.trim().toLowerCase()] = dd ? dd.innerText.trim() : null;
  });
  const txt = document.body.innerText.replace(/\s+/g, " ");
  return {
    kpi,
    inFilter: kpi["in filter"] ?? null,
    inFilterSub: kpi["listings shown"] ?? null,
    srSummaries: [...document.querySelectorAll("p.sr-only")].map((p) => p.innerText.trim()).filter(Boolean).slice(0, 4),
    emptyRow: (txt.match(/No High-motivation listings[^.]*\.|Couldn.t load listings[^—]*—[^.]*\.|Loading listings\./) || [])[0] || null,
    hasZeroClaim: /\b0\s+listings shown/.test(txt) || kpi["in filter"] === "0",
  };
};

(async () => {
  const browser = await launch();
  const out = { base: BASE };
  const say = (s) => console.log(s);

  // ---- state 1: loading (sampled before the response can land) ----
  {
    const ctx = await browser.newContext({ viewport: null });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    // Hold the response so the loading state is observable deterministically.
    let release;
    const gate = new Promise((r) => (release = r));
    await page.route("**/api/deals*", async (route) => {
      await gate;
      await route.continue();
    });
    page.goto(BASE + "/trends", { waitUntil: "load" }).catch(() => {});
    await page.waitForTimeout(1200);
    const loading = await page.evaluate(readAll);
    say(`STATE loading: inFilter="${loading.inFilter}" sub="${loading.inFilterSub}" emptyRow="${loading.emptyRow}" zeroClaim=${loading.hasZeroClaim}`);
    say(`  sr[0]: "${loading.srSummaries[0] || ""}"`);
    out.loading = loading;
    release();
    await page.waitForTimeout(2500);
    const ok = await page.evaluate(readAll);
    say(`STATE loaded: inFilter="${ok.inFilter}" emptyRow="${ok.emptyRow}" zeroClaim=${ok.hasZeroClaim}`);
    say(`  sr[0]: "${ok.srSummaries[0] || ""}"`);
    out.loaded = ok;
    await ctx.close();
  }

  // ---- state 3: forced failure ----
  {
    const ctx = await browser.newContext({ viewport: null });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    const errs = [];
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });
    await page.route("**/api/deals*", (route) => route.abort("failed"));
    await page.goto(BASE + "/trends", { waitUntil: "load" });
    await page.waitForTimeout(3500);
    const failed = await page.evaluate(readAll);
    say(`STATE error: inFilter="${failed.inFilter}" sub="${failed.inFilterSub}" emptyRow="${failed.emptyRow}" zeroClaim=${failed.hasZeroClaim}`);
    say(`  sr[0]: "${failed.srSummaries[0] || ""}"`);
    say(`  console errors (expected 1 network): ${errs.length}`);
    out.forcedFailure = failed;
    out.forcedFailureErrs = errs.length;
    await ctx.close();
  }

  // Verdicts
  out.v = {
    loadingShowsEllipsis: out.loading.inFilter === "…",
    loadingMakesNoZeroClaim: out.loading.hasZeroClaim === false,
    loadedShowsRealCount: out.loaded.inFilter === "133",
    errorDoesNotClaimZero: out.forcedFailure.hasZeroClaim === false,
    errorSaysError: out.forcedFailure.inFilter === "!" || /couldn.t load/i.test(out.forcedFailure.emptyRow || "") || /couldn.t load/i.test(out.forcedFailure.inFilterSub || ""),
    errorSummarySaysError: out.forcedFailure.srSummaries.some((s) => /couldn.t load/i.test(s)),
  };
  say(`VERDICT ${JSON.stringify(out.v)}`);
  writeJson(`${OUT}\\trendstates.json`, out);
  await browser.close();
  say("STATES DONE");
})();
