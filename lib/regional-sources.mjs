import { chromium } from 'playwright';
import { matchRole, isSupportedLocation, safeURL } from '../job-policy.mjs';
import { get, mapLimit, parsePressJob } from './sources.mjs';

export async function collectICIMS(source, fetcher = get) {
  const entries = new Map(); let total, page = 1;
  do {
    if (page > 100) throw new Error('Employer pagination limit reached');
    const url = new URL('/api/jobs', source.url); url.search = new URLSearchParams({ limit: '100', page: String(page) });
    const data = await fetcher(url.href, true);
    if (!Array.isArray(data.jobs) || !Number.isInteger(data.totalCount) || data.totalCount < 0) throw new Error('Employer feed could not be read');
    total = data.totalCount;
    const before = entries.size;
    for (const { data: j } of data.jobs) {
      if (!j?.req_id) throw new Error('Employer feed missing job identifiers');
      entries.set(j.req_id, j);
    }
    if (entries.size === before && entries.size < total) throw new Error('Employer pagination stalled before all jobs were reviewed');
    page++;
  } while (entries.size < total);
  const candidates = [...entries.values()].filter(j => j.applyable === true && j.searchable === true && j.internal !== true &&
    matchRole(j.title) && isSupportedLocation(j.full_location, j.country_code || j.country));
  let failed = 0;
  const jobs = await mapLimit(candidates, 3, async j => {
    try {
      const url = safeURL(j.meta_data?.canonical_url);
      if (!url || new URL(url).origin !== new URL(source.url).origin) throw new Error('Invalid job URL');
      const job = parsePressJob(await fetcher(url), url, { activeFeed: true });
      if (!job) return null;
      if (job.t !== j.title) throw new Error('Job detail title does not match the active feed');
      return { ...job, evidence: 'Published in employer careers API with applications enabled; job detail and closing date checked' };
    } catch { failed++; return null; }
  });
  return { seen: entries.size, jobs: jobs.filter(Boolean), failed };
}

export async function collectRightThere(source) {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch { browser = await chromium.launch({ channel: 'chrome', headless: true }); }
  try {
    const page = await browser.newPage(); page.setDefaultTimeout(25000);
    await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('a[id*="ApplicationHyperlink1"]').first().waitFor();
    const entries = new Map(), fingerprints = new Set();
    for (let n = 0; n < 30; n++) {
      const links = await page.locator('a[id*="ApplicationHyperlink1"]').evaluateAll(els => els.map(a => ({ t: a.textContent.trim(), u: a.href })));
      const fingerprint = links.map(j => j.u).join('|');
      if (fingerprints.has(fingerprint)) throw new Error('Employer pagination repeated');
      fingerprints.add(fingerprint);
      for (const j of links) entries.set(j.u, j);
      const next = page.getByRole('link', { name: 'Next', exact: true }).first();
      if (!(await next.count())) break;
      if (n === 29) throw new Error('Employer pagination limit reached');
      await next.click();
      await page.waitForFunction(old => document.querySelector('a[id*="ApplicationHyperlink1"]')?.href !== old, links[0].u);
    }
    let failed = 0; const jobs = [];
    for (const j of entries.values()) {
      if (!matchRole(j.t)) continue;
      try {
        if (new URL(j.u).origin !== new URL(source.url).origin) throw new Error('Unexpected job host');
        await page.goto(j.u, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const job = parsePressJob(await page.content(), j.u);
        if (job) jobs.push({ ...job, evidence: 'Employer search and application page checked; closing date verified' });
      } catch { failed++; }
    }
    return { jobs, seen: entries.size, failed };
  } finally { await browser.close(); }
}
