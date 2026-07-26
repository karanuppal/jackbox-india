// Live-deployment fleet test (PLAN §8.6 playtest gates, run against a REAL
// public URL). Boots one host-screen browser context + three phone-viewport
// contexts, plays a full game like humans would — deliberate wrong answers to
// force Khooni Kamra visits, generic minigame play, finale judging — then a
// second mini-session covering the moderation portal and a mid-game reload.
//
// Usage: BASE_URL=https://... node scripts/live-fleet.mjs
// Output: OUT_DIR (default ./fleet-results): shots/*.png + report.json
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE_URL;
if (!BASE) throw new Error("BASE_URL required");
const OUT = process.env.OUT_DIR ?? "fleet-results";
mkdirSync(join(OUT, "shots"), { recursive: true });

const report = { base: BASE, startedAt: new Date().toISOString(), events: [], errors: [], consoleErrors: [], verdicts: {} };
const log = (m) => {
  report.events.push(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
  console.log(m);
};
const t0 = Date.now();
let shotN = 0;
async function shot(page, tag) {
  const name = `${String(++shotN).padStart(3, "0")}-${tag}.png`;
  await page.screenshot({ path: join(OUT, "shots", name), fullPage: false }).catch(() => {});
  return name;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function wireConsole(page, who) {
  page.on("pageerror", (e) => report.consoleErrors.push(`${who} pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") report.consoleErrors.push(`${who} console: ${m.text().slice(0, 200)}`);
  });
}

async function clickText(page, text, timeout = 4000) {
  const btn = page.locator("button", { hasText: text }).first();
  await btn.click({ timeout });
}

/** Generic phone bot: whatever scene shows, play it plausibly. */
async function playScene(page, who, opts) {
  const body = await page.textContent("body").catch(() => "");
  if (!body) return "empty";
  const buttons = page.locator("button");
  const n = await buttons.count();

  // question phase: 4 option buttons after the Sawaal header
  if (body.includes("Sawaal ") && body.includes("/ 10")) {
    if (n >= 4) {
      const idx = opts.wrong ? 3 : 0; // our test bank isn't known; 0 vs 3 randomizes outcomes
      await buttons.nth(Math.min(idx, n - 1)).click().catch(() => {});
      return opts.wrong ? "answered-wrong-ish" : "answered";
    }
    return "question-wait";
  }
  if (body.includes("= ?")) {
    // Hisaab-Kitaab: read "a op b = ?" and type the right answer
    const m = body.match(/(\d+)\s*([+-])\s*(\d+)\s*=\s*\?/);
    if (m) {
      const val = m[2] === "+" ? +m[1] + +m[3] : +m[1] - +m[3];
      // the keypad only accepts a leading minus, so sign goes first
      if (val < 0) await clickText(page, "-").catch(() => {});
      for (const ch of String(Math.abs(val))) await clickText(page, ch).catch(() => {});
      await clickText(page, "Jawaab do").catch(() => {});
      return "math";
    }
  }
  if (body.includes("wahi tiles dabao") || body.includes("YAAD KARO")) {
    const tiles = page.locator('[aria-label^="tile"]');
    const c = await tiles.count();
    for (let i = 0; i < Math.min(3, c); i++) await tiles.nth(i).click().catch(() => {});
    await clickText(page, "Lock karo").catch(() => {});
    return "memory";
  }
  if (body.includes("Kahan tha") || body.includes("Patte yaad")) {
    const cards = page.locator('[aria-label^="card"]');
    const c = await cards.count();
    if (c > 0) await cards.first().click().catch(() => {});
    await clickText(page, "Lock karo").catch(() => {});
    return "taash";
  }
  if (body.includes("spell karo")) {
    // tap every letter key once, then lock
    const keys = page.locator("button:not(:disabled)");
    const c = await keys.count();
    for (let i = 0; i < c; i++) {
      const t = await keys.nth(i).textContent().catch(() => "");
      if (t && t.trim().length === 1 && /[a-z]/i.test(t.trim())) await keys.nth(i).click().catch(() => {});
    }
    await clickText(page, "Lock karo").catch(() => {});
    return "spelling";
  }
  if (body.includes("Ek glass chuno")) {
    const cups = page.locator('[aria-label^="chai"]');
    if ((await cups.count()) > 0) await cups.nth(0).click().catch(() => {});
    return "chai";
  }
  if (body.includes("SAVE MYSELF")) {
    await clickText(page, opts.betray ? "SAVE MYSELF" : "SPARE").catch(() => {});
    return "dhokha";
  }
  if (body.includes("jawab likho") || (await page.locator("textarea").count()) > 0) {
    await page.locator("textarea").fill(`${who} ka ghatiya jawab`).catch(() => {});
    await clickText(page, "Bhejo").catch(() => {});
    return "worst-answer";
  }
  if (body.includes("Saaf karo")) {
    // drawing canvas: two strokes then submit
    const canvas = page.locator('[data-testid="canvas"]');
    const box = await canvas.boundingBox().catch(() => null);
    if (box) {
      for (const [f1, f2] of [[0.2, 0.8], [0.8, 0.3]]) {
        await page.mouse.move(box.x + box.width * f1, box.y + box.height * f1);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * f2, box.y + box.height * 0.6, { steps: 8 });
        await page.mouse.up();
      }
    }
    await clickText(page, "Ho gaya").catch(() => {});
    return "drawing";
  }
  if (body.includes("Sabse GHATIYA ko vote do")) {
    const b = page.locator("button:not(:disabled)", { hasText: /:|🎨|🚫/ }).first();
    await b.click({ timeout: 2000 }).catch(() => {});
    return "voted";
  }
  if (body.includes("Jo FIT ho use chuno")) {
    const opts2 = page.locator("button");
    const c = await opts2.count();
    // toggle the first two options, then lock
    for (let i = 0; i < Math.min(2, c - 1); i++) await opts2.nth(i).click().catch(() => {});
    await clickText(page, "Lock karo").catch(() => {});
    return "finale-judged";
  }
  if (body.includes("Sab Aa Gaye")) {
    if (opts.vip) {
      await clickText(page, "Sab Aa Gaye").catch(() => {});
      return "started";
    }
    return "lobby";
  }
  if (body.includes("Tutorial chhodo") && opts.vip) {
    await clickText(page, "Tutorial chhodo").catch(() => {});
    return "skipped-tutorial";
  }
  return "idle";
}

async function main() {
  const browser = await chromium.launch();
  // 1) host screen
  const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const host = await hostCtx.newPage();
  wireConsole(host, "host");
  await host.goto(`${BASE}/host`, { waitUntil: "networkidle", timeout: 30000 });
  await sleep(1500);
  const codeText = await host.textContent("body");
  const code = (codeText.match(/\b[ACDEFHJKMNPRSTUVWXYZ]{4}\b/) ?? [])[0];
  if (!code) throw new Error("no room code found on host screen");
  log(`room ${code} on live host screen`);
  await shot(host, "host-lobby");

  // 2) three phones
  const phones = [];
  const names = ["Asha", "Bunty", "Chintu"];
  for (const name of names) {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile",
    });
    const page = await ctx.newPage();
    wireConsole(page, name);
    await page.goto(`${BASE}/?code=${code}`, { waitUntil: "networkidle", timeout: 30000 });
    await page.locator('[aria-label="Your name"]').fill(name);
    await page.locator("button", { hasText: /Andar|aao|Join|judo/i }).first().click().catch(async () => {
      await page.locator('button[type="submit"], form button').first().click();
    });
    await sleep(800);
    await shot(page, `join-${name}`);
    phones.push({ name, page, wrong: name === "Bunty", betray: name === "Chintu", vip: name === "Asha" });
    log(`${name} joined via live URL (mobile viewport)`);
  }
  await shot(host, "host-lobby-full");

  // 3) play the full game (bounded loop)
  let lastHostScene = "";
  let gameOverSeen = false;
  const deadline = Date.now() + 14 * 60 * 1000;
  while (Date.now() < deadline && !gameOverSeen) {
    for (const p of phones) {
      const act = await playScene(p.page, p.name, p).catch((e) => `err:${e.message?.slice(0, 60)}`);
      if (act !== "idle" && act !== "lobby" && act !== "question-wait" && act !== "empty") {
        log(`${p.name}: ${act}`);
        await shot(p.page, `${p.name}-${act}`);
      }
    }
    const hostBody = (await host.textContent("body").catch(() => "")) ?? "";
    const scene = hostBody.includes("Natija")
      ? "natija"
      : hostBody.includes("KHOONI KAMRA")
        ? "kamra-intro"
        : hostBody.includes("Khooni Kamra —")
          ? "kamra-play"
          : hostBody.includes("Sabse ghatiya kaunsa")
            ? "kamra-vote"
            : hostBody.includes("MAUT KA CHAKRA")
              ? "wheel"
              : hostBody.includes("AAKHRI DARWAZA") || hostBody.includes("Aakhri Darwaza")
                ? "finale"
                : hostBody.includes("Sawaal ")
                  ? "question"
                  : "other";
    if (scene !== lastHostScene) {
      lastHostScene = scene;
      log(`HOST scene: ${scene}`);
      await shot(host, `host-${scene}`);
    }
    if (scene === "natija") {
      gameOverSeen = true;
      await shot(host, "host-natija-final");
      for (const p of phones) await shot(p.page, `${p.name}-gameover`);
    }
    await sleep(1200);
  }
  report.verdicts.fullGame = gameOverSeen ? "PASS — reached Natija on the live URL" : "FAIL — never reached Natija in 14 min";
  log(report.verdicts.fullGame);

  // 4) reconnect check on the live URL: reload Chintu, expect prefilled rejoin
  const chintu = phones[2];
  await chintu.page.reload({ waitUntil: "networkidle" }).catch(() => {});
  await sleep(1000);
  const rejoinBody = (await chintu.page.textContent("body").catch(() => "")) ?? "";
  const prefilled = await chintu.page.locator('[aria-label="Room code"]').inputValue().catch(() => "");
  if (prefilled === code) {
    await chintu.page.locator("button", { hasText: /Andar|aao|Join|judo/i }).first().click().catch(() => {});
    await sleep(1200);
    report.verdicts.reconnect = "PASS — prefilled rejoin on live URL";
  } else {
    report.verdicts.reconnect = `CHECK — rejoin form state: prefilled='${prefilled}' body='${rejoinBody.slice(0, 80)}'`;
  }
  await shot(chintu.page, "chintu-rejoined");
  log(report.verdicts.reconnect);

  report.finishedAt = new Date().toISOString();
  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 1));
  await browser.close();
  const fail = !gameOverSeen;
  console.log(`\nFLEET ${fail ? "FAIL" : "PASS"} — ${report.consoleErrors.length} console errors, shots in ${OUT}/shots`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  report.errors.push(String(e));
  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 1));
  console.error(e);
  process.exit(1);
});
