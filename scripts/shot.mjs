// Headless screenshot helper for visual checks. Usage: node scripts/shot.mjs <out.png> [js to run before capture]
import puppeteer from 'puppeteer-core';

const out = process.argv[2] ?? '.cache/shot.png';
const script = process.argv[3] ?? '';
const url = process.env.URL ?? 'http://localhost:3100/';
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'networkidle2', timeout: 120000 });
await page.waitForFunction(() => !document.querySelector('.loading'), { timeout: 120000 }).catch(() => logs.push('[timeout] still loading'));
await new Promise((r) => setTimeout(r, 1500));
if (script) { await page.evaluate(script); await new Promise((r) => setTimeout(r, 1200)); }
if (process.env.SCRIPT2) { await page.evaluate(process.env.SCRIPT2); await new Promise((r) => setTimeout(r, 2500)); }
if (process.env.STRETCH) console.log('SPREAD', JSON.stringify(await page.evaluate(async (P) => {
  const v = window.__physio.viewer();
  v.rig.pose({}); const rest = v.spread();
  v.rig.pose(P); const now = v.spread();
  return Object.keys(rest).map((k) => [k, +(now[k] / rest[k]).toFixed(2)]).filter(([, r]) => r > 1.35).sort((a, b) => b[1] - a[1]);
}, JSON.parse(process.env.STRETCH))));
await page.screenshot({ path: out });
console.log(logs.filter((l) => !/Download the React DevTools|HMR|Fast Refresh/.test(l)).slice(0, 15).join('\n') || 'no console output');
await browser.close();
