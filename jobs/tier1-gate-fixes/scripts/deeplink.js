// /trends deep-link race: 6 consecutive loads of the deep link, plus the same
// link on /map and /data. Records the rendered cohort count and the exact
// /api/deals request sequence (URL + order) so a late default-cohort response
// is visible in the log rather than inferred.
const { launch, cell, BASE, OUT, writeJson, writeText } = require("./lib");

const TAG = process.env.TAG || "before";
const RUNS = Number(process.env.RUNS || 6);
const QS = "?score=High&min_dom=90";

const READ = () => {
  const txt = document.body.innerText.replace(/\s+/g, " ");
  const kpi = {};
  document.querySelectorAll("dl dt").forEach((dt) => {
    const dd = dt.parentElement.querySelector("dd");
    kpi[dt.innerText.trim()] = dd ? dd.innerText.trim() : null;
  });
  const rows = document.querySelectorAll("tbody tr");
  const csv = [...document.querySelectorAll("a")].find((a) => /Download .*rows as CSV/.test(a.innerText));
  return {
    path: location.pathname,
    search: location.search,
    inFilter: kpi["IN FILTER"] || kpi["In filter"] || null,
    kpi,
    shownOf: (txt.match(/(\d+) of ([\d,…]+) shown/) || []).slice(0, 3),
    shownShort: (txt.match(/(\d+) shown/) || []).slice(0, 2),
    rowCount: rows.length,
    firstRow: rows[0] ? rows[0].innerText.replace(/\s+/g, " ").slice(0, 60) : null,
    csvText: csv ? csv.innerText.trim() : null,
    scorePills: [
      ...new Set(
        [...document.querySelectorAll("tbody span")]
          .filter((s) => /^(High|Medium|Low)$/.test(s.innerText.trim()))
          .map((s) => s.innerText.trim())
      ),
    ],
    slider: (() => {
      const s = document.querySelector("input[type=range]");
      return s ? s.value : null;
    })(),
  };
};

(async () => {
  const browser = await launch();
  const R = { tag: TAG, base: BASE, qs: QS, runs: [] };
  const log = [];
  const say = (...a) => {
    const s = a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
    console.log(s);
    log.push(s);
  };

  for (const route of ["/trends", "/map", "/data"]) {
    const counts = [];
    for (let i = 1; i <= RUNS; i++) {
      const c = await cell(browser, route + QS, 1280, 900, { settle: 13000, watchApi: true });
      const read = await c.page.evaluate(READ);
      const api = c.api.map((a) => a.url);
      const rec = {
        route,
        run: i,
        ...read,
        api,
        apiCount: api.length,
        defaultFirst: api.length > 1 && /\bscore=High%2CMedium\b|score=High,Medium/.test(api[0]) && /min_dom=60/.test(api[0]),
        errs: c.errs,
        failed: c.failed,
        bad: c.bad,
      };
      R.runs.push(rec);
      counts.push(route === "/data" ? rec.shownShort[0] || rec.csvText : route === "/map" ? rec.shownOf[0] : rec.inFilter);
      say(
        `DEEPLINK ${TAG} ${route}${QS} run${i}: ` +
          (route === "/trends"
            ? `inFilter=${read.inFilter}`
            : route === "/map"
              ? `shownOf=${JSON.stringify(read.shownOf)}`
              : `shown={${JSON.stringify(read.shownShort)}} csv="${read.csvText}" rows=${read.rowCount}`) +
          ` apiCalls=${JSON.stringify(api)} errs=${c.errs.length}`
      );
      await c.ctx.close();
    }
    R[route + "_counts"] = counts;
    say(`COUNTS ${TAG} ${route}${QS} -> ${JSON.stringify(counts)}`);
  }

  writeJson(`${OUT}\\deeplink-${TAG}.json`, R);
  writeText(`${OUT}\\deeplink-${TAG}.log.txt`, log.join("\n"));
  await browser.close();
  console.log("DEEPLINK DONE " + TAG);
})();
