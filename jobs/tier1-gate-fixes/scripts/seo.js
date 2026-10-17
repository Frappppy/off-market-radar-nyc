// SEO basics: robots.txt / sitemap.xml / favicon.ico / manifest.webmanifest
// status, and per-route <title> + description + canonical + og/twitter titles.
const { BASE, OUT, writeJson, writeText } = require("./lib");
const fs = require("fs");

const TAG = process.env.TAG || "before";
const ROUTES = ["/", "/map", "/data", "/trends"];

const grab = (html, re) => {
  const m = re.exec(html);
  return m ? m[1].replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').trim() : null;
};

(async () => {
  const R = { tag: TAG, base: BASE, files: {}, routes: {} };
  const log = [];
  const say = (...a) => {
    const s = a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
    console.log(s);
    log.push(s);
  };

  for (const p of ["/robots.txt", "/sitemap.xml", "/favicon.ico", "/manifest.webmanifest", "/icon.svg"]) {
    const res = await fetch(BASE + p, { redirect: "manual" });
    const body = await res.text();
    R.files[p] = {
      status: res.status,
      type: res.headers.get("content-type"),
      len: body.length,
      body: body.slice(0, 1200),
    };
    say(`FILE ${TAG} ${p} -> ${res.status} ${res.headers.get("content-type")} len=${body.length}`);
    if (/robots|sitemap|manifest/.test(p) && res.status === 200) say("   " + body.replace(/\s+/g, " ").slice(0, 300));
  }

  for (const route of ROUTES) {
    const res = await fetch(BASE + route);
    const html = await res.text();
    const rec = {
      status: res.status,
      title: grab(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
      description: grab(html, /<meta name="description" content="([^"]*)"/i),
      canonical: grab(html, /<link rel="canonical" href="([^"]*)"/i),
      ogTitle: grab(html, /<meta property="og:title" content="([^"]*)"/i),
      ogDescription: grab(html, /<meta property="og:description" content="([^"]*)"/i),
      ogType: grab(html, /<meta property="og:type" content="([^"]*)"/i),
      twitterTitle: grab(html, /<meta name="twitter:title" content="([^"]*)"/i),
      ogCount: (html.match(/property="og:/g) || []).length,
      twitterCount: (html.match(/name="twitter:/g) || []).length,
    };
    R.routes[route] = rec;
    say(
      `ROUTE ${TAG} ${route} title="${rec.title}" desc="${rec.description}" canonical=${rec.canonical} ogCount=${rec.ogCount} twitterCount=${rec.twitterCount}`
    );
  }

  writeJson(`${OUT}\\seo-${TAG}.json`, R);
  writeText(`${OUT}\\seo-${TAG}.log.txt`, log.join("\n"));
  console.log("SEO DONE " + TAG);
})();
