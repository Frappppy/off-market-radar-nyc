// Diagnostic: what IS the pin's real geometry (layout, pseudo-element box,
// hit box edges at sub-pixel resolution, containing-block check)?
const { launch, cell, OUT, writeJson } = require("./lib");

const DIAG = () => {
  const pins = [...document.querySelectorAll(".maplibre-pin")];
  const out = [];
  for (const pin of pins.slice(0, 6)) {
    pin.scrollIntoView({ block: "center", inline: "center" });
    const r = pin.getBoundingClientRect();
    const cs = getComputedStyle(pin);
    const before = getComputedStyle(pin, "::before");
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    // sub-pixel edge search along each axis, 0.25px steps
    const edge = (dx, dy) => {
      let last = 0;
      for (let d = 0; d <= 32; d += 0.25) {
        const x = cx + dx * d;
        const y = cy + dy * d;
        if (document.elementFromPoint(x, y) === pin) last = d;
      }
      return Number(last.toFixed(2));
    };
    const right = edge(1, 0);
    const left = edge(-1, 0);
    const down = edge(0, 1);
    const up = edge(0, -1);
    // where does the pseudo box actually start? find left/right edges of pin
    // hit region in page coords
    out.push({
      classes: pin.getAttribute("class"),
      pinPosition: cs.position,
      pinBox: [Number(r.x.toFixed(2)), Number(r.y.toFixed(2)), Number(r.width.toFixed(2)), Number(r.height.toFixed(2))],
      pinParentClass: pin.parentElement && pin.parentElement.getAttribute("class"),
      pinParentPosition: pin.parentElement && getComputedStyle(pin.parentElement).position,
      before: {
        position: before.position,
        width: before.width,
        height: before.height,
        top: before.top,
        left: before.left,
        margin: before.margin,
        content: before.content,
      },
      centreReach: { right, left, down, up },
      trueBox: [Number((left + right).toFixed(2)), Number((up + down).toFixed(2))],
    });
  }
  return out;
};

(async () => {
  const browser = await launch();
  const R = {};
  for (const [w, h] of [
    [390, 844],
    [1280, 900],
  ]) {
    const c = await cell(browser, "/map", w, h, { settle: 9000 });
    await c.page
      .waitForFunction(() => document.querySelectorAll(".maplibre-pin").length > 0, { timeout: 30000 })
      .catch(() => {});
    await c.page.waitForTimeout(1200);
    R[w] = await c.page.evaluate(DIAG);
    console.log("DIAG @" + w + " " + JSON.stringify(R[w], null, 1));
    await c.ctx.close();
  }
  writeJson(`${OUT}\\pin-diag.json`, R);
  await browser.close();
})();
