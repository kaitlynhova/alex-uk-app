import { chromium } from 'playwright';
import { matchRole } from '../job-policy.mjs';
import { parsePressJob } from './sources.mjs';

export async function collectCambridgePress(source) {
  // This board populates its results and pagination with JavaScript.
  // Use an ordinary browser session; never interpret its initial HTML as an empty board.
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch { browser = await chromium.launch({ channel: 'chrome', headless: true }); }
  try {
    const page = await browser.newPage(); page.setDefaultTimeout(20000);
    await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('a[href*="/description/"], .no-results').first().waitFor();
    const candidates = new Map(), visited = new Set(); let seen = 0;
    for (let n = 0; n < 30; n++) {
      const links = await page.locator('a[href*="/description/"]').evaluateAll(els => els.map(a => ({ t: a.textContent.trim(), u: a.href })));
      const fingerprint = links.map(a => a.u).join('|');
      if (visited.has(fingerprint)) throw new Error('Cambridge pagination repeated; could not complete check');
      visited.add(fingerprint); seen += links.length;
      for (const link of links) if (matchRole(link.t)) candidates.set(link.u, link);
      const next = page.locator('a.scroller_movenext:not([disabled]):not(.buttonDisabled)');
      if (!(await next.count())) break;
      if (n === 29) throw new Error('Cambridge pagination limit reached');
      const first = links[0]?.u;
      await next.click();
      await page.waitForFunction(old => document.querySelector('a[href*="/description/"]')?.href !== old, first);
    }
    const jobs = []; let failed = 0;
    for (const { u } of candidates.values()) {
      try {
        await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.locator('h1').first().waitFor();
        const html = await page.content();
        const job = parsePressJob(html, u);
        if (job) jobs.push({ ...job, evidence: 'Employer search and vacancy page checked; application control and closing date present' });
      } catch { failed++; }
    }
    return { jobs, seen, failed };
  } finally { await browser.close(); }
}
