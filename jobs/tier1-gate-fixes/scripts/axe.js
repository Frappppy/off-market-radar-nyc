// axe-core sweep across the four routes at 390 and 1280, plus a DOM inventory
// of the SVG / interactive surfaces on /trends (the svg-img-alt + unnamed <g>
// surfaces) so the fix targets real nodes.
//
// Same method as jobs/tier1-deployed-qa/evidence/raw/probes-b.js: inject
// axe.min.js into the page and run with the same runOnly tag set.
const fs = require("fs");
const { launch, cell, BASE, AXE, OUT, writeJson, writeText } = require("./lib");

const TAG = process.env.TAG || "before";
const ROUTES = ["/", "/map", "/data", "/trends"];
const VIEWS = [
  [390, 844],
  [1280, 900],
];

const INVENTORY = () => {
  const nameOf = (el) => {
    const al = el.getAttribute("aria-label");
    if (al && al.trim()) return al.trim();
    const lb = el.getAttribute("aria-labelledby");
    if (lb) {
      const t = lb
        .split(/\s+/)
        .map((id) => (document.getElementById(id) || {}).innerText || "")
        .join(" ")
        .trim();
      if (t) return t;
    }
    const t = (el.innerText || el.textContent || "").trim();
    if (t) return t.slice(0, 60);
    const ti = el.getAttribute("title");
    if (ti && ti.trim()) return ti.trim();
    if (el.tagName === "INPUT") {
      if (el.type === "submit" || el.type === "button") return el.value || null;
      const lab = el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (lab && lab.innerText.trim()) return lab.innerText.trim();
      if (el.closest("label")) return el.closest("label").innerText.trim();
      if (el.type === "range" || el.type === "number" || el.type === "text") return el.value || null;
    }
    if (el.tagName === "SELECT") {
      const lab = el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (lab && lab.innerText.trim()) return lab.innerText.trim();
    }
    return null;
  };
  // Every SVG node that axe's svg-img-alt could target: role=img (explicit or
  // implicit via <svg>).
  const imgRoles = [...document.querySelectorAll("svg, svg [role=img], [role=img]")].map((e) => ({
    tag: e.tagName.toLowerCase(),
    cls: (e.getAttribute("class") || "").slice(0, 90),
    role: e.getAttribute("role"),
    name: e.getAttribute("name"),
    label: e.getAttribute("aria-label"),
    text: (e.textContent || "").trim().slice(0, 40),
    parentCls: (e.parentElement && e.parentElement.getAttribute && e.parentElement.getAttribute("class") || "").slice(0, 60),
  }));
  // The interactive-control sweep the gate used to find the unnamed <g>.
  const controls = [
    ...document.querySelectorAll("button, a[href], input, select, textarea, [role=button], [tabindex='0']"),
  ];
  const unnamed = controls
    .filter((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const vis =
        r.width > 0 &&
        r.height > 0 &&
        cs.visibility !== "hidden" &&
        cs.display !== "none" &&
        cs.opacity !== "0" &&
        el.offsetParent !== null;
      const disabled =
        el.disabled === true ||
        el.getAttribute("aria-disabled") === "true" ||
        el.closest("[aria-disabled=true]");
      return vis && !disabled && !nameOf(el);
    })
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      cls: (el.getAttribute("class") || "").slice(0, 80),
      role: el.getAttribute("role"),
      tabindex: el.getAttribute("tabindex"),
      outer: el.outerHTML.slice(0, 200),
    }));
  // Heading order in document order.
  const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map(
    (e) => e.tagName.toLowerCase() + ":" + (e.innerText || "").trim().slice(0, 40)
  );
  // Empty table headers.
  const emptyTh = [...document.querySelectorAll("th")].filter(
    (th) => !(th.innerText || "").trim() && !th.getAttribute("aria-label") && !th.getAttribute("aria-labelledby")
  ).length;
  return {
    imgRoleCount: imgRoles.length,
    imgRoleSample: imgRoles.slice(0, 12),
    unnamedCount: unnamed.length,
    unnamed,
    headings,
    emptyTh,
    iw: window.innerWidth,
  };
};

(async () => {
  const browser = await launch();
  const R = { tag: TAG, base: BASE, cells: {}, axe: {}, inventory: {} };
  const log = [];
  const say = (...a) => {
    const s = a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
    console.log(s);
    log.push(s);
  };

  // ---- axe ----
  for (const route of ROUTES) {
    for (const [w, h] of VIEWS) {
      const c = await cell(browser, route, w, h, {
        settle: route === "/trends" || route === "/map" ? 13000 : 10000,
      });
      try {
        await c.page.addScriptTag({ path: AXE });
        const res = await c.page.evaluate(async () => {
          const r = await window.axe.run(document, {
            resultTypes: ["violations", "incomplete"],
            runOnly: {
              type: "tag",
              values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"],
            },
          });
          const map = (xs) =>
            xs.map((v) => ({
              id: v.id,
              impact: v.impact,
              help: v.help,
              nodes: v.nodes.length,
              targets: v.nodes.slice(0, 6).map((n) => n.target.join(" ")),
              summary: ((v.nodes[0] && v.nodes[0].failureSummary) || "").slice(0, 200),
            }));
          return {
            violations: map(r.violations),
            incomplete: map(r.incomplete),
            passes: r.passes.length,
            version: window.axe.version,
          };
        });
        R.axe[route + "@" + w] = res;
        const byRule = res.violations.map((v) => `${v.id}[${v.impact}]x${v.nodes}`);
        say(
          `AXE ${TAG} ${route}@${w} (axe ${res.version}): violations=${res.violations.length} ` +
            `serious+critical=${res.violations.filter((v) => v.impact === "serious" || v.impact === "critical").length} ` +
            `rules=${JSON.stringify(byRule)} passes=${res.passes}`
        );
      } catch (e) {
        R.axe[route + "@" + w] = { error: String(e).slice(0, 400) };
        say(`AXE ${TAG} ${route}@${w} FAILED: ${String(e).slice(0, 200)}`);
      }
      if (route === "/trends" || route === "/map") {
        R.inventory[route + "@" + w] = await c.page.evaluate(INVENTORY);
        const inv = R.inventory[route + "@" + w];
        say(
          `INV ${TAG} ${route}@${w}: roleImg=${inv.imgRoleCount} unnamedControls=${inv.unnamedCount} emptyTh=${inv.emptyTh} headings=${JSON.stringify(inv.headings)}`
        );
        if (inv.unnamedCount) say("   unnamed " + JSON.stringify(inv.unnamed));
      }
      await c.ctx.close();
    }
  }

  writeJson(`${OUT}\\axe-${TAG}.json`, R);
  writeText(`${OUT}\\axe-${TAG}.log.txt`, log.join("\n"));
  // Keep the per-route rows in one flat list for the report.
  const flat = [];
  for (const k of Object.keys(R.axe)) {
    const a = R.axe[k];
    if (a.violations && a.violations.length) {
      for (const v of a.violations) flat.push({ cell: k, id: v.id, impact: v.impact, nodes: v.nodes });
    } else {
      flat.push({ cell: k, id: "-", impact: "-", nodes: 0 });
    }
  }
  fs.writeFileSync(`${OUT}\\axe-${TAG}-flat.json`, JSON.stringify(flat, null, 2));
  await browser.close();
  console.log("AXE SWEEP DONE " + TAG);
})();
