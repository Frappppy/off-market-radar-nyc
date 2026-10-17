// Map pin hit-area measurement. Hit-tests the REAL box with elementFromPoint
// (topmost element only), walking one pixel at a time outward from the pin
// centre in each of the four axes. Never trusts getBoundingClientRect.
//
// Mirrors the gate's fix for its own first-pass artefacts:
//   - scroll the pin into view before sampling (elementFromPoint returns null
//     outside the viewport),
//   - test the TOPMOST element only (elementsFromPoint().some() counted the pin
//     when it merely sat under the canvas).
const { launch, cell, OUT, writeJson, writeText } = require("./lib");

const TAG = process.env.TAG || "before";
const VIEWS = [
  [390, 844],
  [1280, 900],
  [1350, 940],
];

const MEASURE = () => {
  const pinSel = ".maplibre-pin";
  const pins = [...document.querySelectorAll(pinSel)];
  const topmost = (x, y) => document.elementFromPoint(x, y);
  const isPin = (el, pin) => el === pin;
  const out = [];
  for (const pin of pins) {
    pin.scrollIntoView({ block: "center", inline: "center" });
    const r = pin.getBoundingClientRect();
    const cx = Math.round(r.x + r.width / 2);
    const cy = Math.round(r.y + r.height / 2);
    const cxF = r.x + r.width / 2;
    const cyF = r.y + r.height / 2;
    if (cx < 1 || cy < 1 || cx > window.innerWidth - 1 || cy > window.innerHeight - 1) {
      out.push({ skipped: "offscreen", rect: [r.x, r.y, r.width, r.height] });
      continue;
    }
    // sanity: centre lands on the pin
    const centreTop = topmost(cx, cy);
    const sweep = (dx, dy) => {
      let n = 0;
      for (let i = 1; i <= 48; i++) {
        const x = cx + dx * i;
        const y = cy + dy * i;
        if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) break;
        if (isPin(topmost(x, y), pin)) n = i;
        else break;
      }
      return n;
    };
    const right = sweep(1, 0);
    const left = sweep(-1, 0);
    const down = sweep(0, 1);
    const up = sweep(0, -1);
    // diagonal reach (a rounded box would be much shorter here)
    let diag = 0;
    for (let i = 1; i <= 48; i++) {
      const x = cx + i;
      const y = cy + i;
      if (x >= window.innerWidth || y >= window.innerHeight) break;
      if (isPin(topmost(x, y), pin)) diag = i;
      else break;
    }
    // Sub-pixel edge search (0.25px): removes the +/-1 rounding artefact of the
    // integer walk above, so the TRUE painted hit box is reported alongside the
    // integer one the gate measured.
    const edge = (dx, dy) => {
      let last = 0;
      for (let d = 0; d <= 40; d += 0.25) {
        const x = cxF + dx * d;
        const y = cyF + dy * d;
        if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) break;
        if (isPin(topmost(x, y), pin)) last = d;
      }
      return last;
    };
    const sub = {
      right: edge(1, 0),
      left: edge(-1, 0),
      down: edge(0, 1),
      up: edge(0, -1),
    };
    out.push({
      layout: [Math.round(r.width), Math.round(r.height)],
      layoutExact: [Number(r.width.toFixed(2)), Number(r.height.toFixed(2))],
      centreOnPin: isPin(centreTop, pin),
      reach: { right, left, down, up, diag },
      hitBox: [left + right + 1, up + down + 1],
      subReach: sub,
      subBox: [
        Number((sub.left + sub.right).toFixed(2)),
        Number((sub.up + sub.down).toFixed(2)),
      ],
      label: pin.getAttribute("aria-label"),
      cluster: /Zoom in on/.test(pin.getAttribute("aria-label") || ""),
    });
  }
  // nearest leaf-centre separation (so a bigger hit box cannot make two pins
  // ambiguous to a thumb)
  const centres = pins
    .filter((p) => !/Zoom in on/.test(p.getAttribute("aria-label") || ""))
    .map((p) => {
      const r = p.getBoundingClientRect();
      return [r.x + r.width / 2, r.y + r.height / 2];
    });
  let minGap = null;
  for (let i = 0; i < centres.length; i++)
    for (let j = i + 1; j < centres.length; j++) {
      const d = Math.hypot(centres[i][0] - centres[j][0], centres[i][1] - centres[j][1]);
      if (minGap == null || d < minGap) minGap = d;
    }
  return { pinCount: pins.length, minGap: minGap == null ? null : Number(minGap.toFixed(2)), pins: out };
};

(async () => {
  const browser = await launch();
  const R = { tag: TAG, cells: {} };
  const log = [];
  const say = (...a) => {
    const s = a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
    console.log(s);
    log.push(s);
  };

  for (const [w, h] of VIEWS) {
    const c = await cell(browser, "/map", w, h, { settle: 9000 });
    await c.page
      .waitForFunction(() => document.querySelectorAll(".maplibre-pin").length > 0, { timeout: 30000 })
      .catch(() => {});
    await c.page.waitForTimeout(1500);
    // measure only leaf pins: cluster pins are 28px by construction and are not
    // the surface the gate flagged.
    const m = await c.page.evaluate(MEASURE);
    const leaves = m.pins.filter((p) => p && p.hitBox && !p.cluster);
    const boxes = leaves.map((p) => p.hitBox);
    const subBoxes = leaves.map((p) => p.subBox);
    const minW = boxes.length ? Math.min(...boxes.map((b) => b[0])) : null;
    const minH = boxes.length ? Math.min(...boxes.map((b) => b[1])) : null;
    const minSubW = subBoxes.length ? Math.min(...subBoxes.map((b) => b[0])) : null;
    const minSubH = subBoxes.length ? Math.min(...subBoxes.map((b) => b[1])) : null;
    const maxSubW = subBoxes.length ? Math.max(...subBoxes.map((b) => b[0])) : null;
    const maxSubH = subBoxes.length ? Math.max(...subBoxes.map((b) => b[1])) : null;
    const layouts = [...new Set(leaves.map((p) => p.layout.join("x")))];
    R.cells[w] = {
      ...m,
      leaves: leaves.length,
      minHitW: minW,
      minHitH: minH,
      minSubW,
      minSubH,
      maxSubW,
      maxSubH,
      layouts,
    };
    say(
      `PINS ${TAG} @${w}: pins=${m.pinCount} leaves=${leaves.length} layout=${JSON.stringify(layouts)} ` +
        `integerHitBox=[${minW},${minH}] subPixelBox=[${minSubW}..${maxSubW} , ${minSubH}..${maxSubH}] ` +
        `minLeafGap=${m.minGap} centreOnPinAll=${leaves.every((p) => p.centreOnPin)}`
    );
    say(
      "   sample " +
        JSON.stringify(
          leaves.slice(0, 4).map((p) => ({ layout: p.layout, reach: p.reach, hitBox: p.hitBox, subBox: p.subBox }))
        )
    );
    await c.ctx.close();
  }

  writeJson(`${OUT}\\pins-${TAG}.json`, R);
  writeText(`${OUT}\\pins-${TAG}.log.txt`, log.join("\n"));
  await browser.close();
  console.log("PINS DONE " + TAG);
})();
