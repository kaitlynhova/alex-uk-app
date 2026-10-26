import { load } from 'cheerio';
import { matchRole, isUKLocation, safeURL, closingTime } from '../job-policy.mjs';

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
export function htmlText(value) {
  let text = String(value || '');
  // Some ATS feeds HTML-encode the entire description, rather than returning raw HTML.
  for (let pass = 0; pass < 2; pass++) {
    const $ = load(text); $('script,style').remove(); $('p,li,div,h1,h2,h3,br').append(' ');
    text = $.text();
    if (!/<\/?[a-z][^>]*>/i.test(text)) break;
  }
  return clean(text);
}
export async function get(url, json = false) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'AlexSponsorFinder/2.0 (personal vacancy checker)', Accept: json ? 'application/json' : 'text/html' } });
  if (response.status !== 200) throw new Error(`Source returned HTTP ${response.status}; vacancies could not be verified`);
  const body = await response.text();
  if (!body.trim() || /<title>[^<]*(access denied|just a moment|service temporarily unavailable)/i.test(body)) throw new Error('Source requires a browser check or is unavailable');
  return json ? JSON.parse(body) : body;
}

export async function mapLimit(items, concurrency, fn) {
  let index = 0; const results = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) { const i = index++; results[i] = await fn(items[i]); }
  }));
  return results;
}

export function parseUniversity(html, base) {
  const $ = load(html), jobs = [];
  $('tr').each((_, tr) => {
    const row = $(tr), a = row.find('.views-field-title a');
    if (!a.length) return;
    const t = clean(a.text());
    const date = row.find('.views-field-field-closing-date time').attr('datetime');
    jobs.push({ t, u: new URL(a.attr('href'), base).href, l: 'Cambridge, UK', country: 'GB',
      closesAt: date?.slice(0, 10), salary: clean(row.find('.views-field-field-salary').text()),
      department: clean(row.find('.views-field-field-department-location').text()) });
  });
  if (!jobs.length && !/Found\s+0\s+vacancies/i.test($.text())) throw new Error('University job table not found; source layout may have changed');
  return { jobs, next: $('a[rel="next"], .pager__item--next a').first().attr('href') };
}

// eArcu's public vacancy pages include JSON-LD on some deployments and labelled fields on others.
export function parsePressJob(html, url, { activeFeed = false } = {}) {
  const $ = load(html);
  const text = clean($('main').text() || $('body').text());
  if (/\b(vacancy (?:has |is )?(?:now )?closed|no longer accepting applications|job (?:has expired|not found)|no longer available)\b/i.test(text)) return null;
  let structured;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const walk = o => {
        if (Array.isArray(o)) o.forEach(walk);
        else if (o && typeof o === 'object') {
          if ([o['@type']].flat().includes('JobPosting')) structured = o;
          if (o['@graph']) walk(o['@graph']);
        }
      }; walk(JSON.parse($(el).text()));
    } catch { /* A malformed unrelated script is not job evidence. */ }
  });
  const field = name => clean(text.match(new RegExp(`${name}:?\\s*(.*?)\\s*(?=Country:|Business Unit:|Vacancy Type:|Closing Date:|Location:|Salary:|Job Title:|Meet the recruiter|$)`, 'i'))?.[1]);
  const t = clean(structured?.title || $('h1').first().text());
  const rawClose = structured?.validThrough || field('Closing Date').match(/\d{1,2}\s+[A-Za-z]+\s+\d{4}/)?.[0];
  const closesAt = rawClose && (/^\d{4}-/.test(rawClose) ? rawClose : new Date(rawClose + ' UTC').toISOString().slice(0, 10));
  const address = [structured?.jobLocation].flat().find(Boolean)?.address;
  const country = typeof address?.addressCountry === 'object' ? address.addressCountry.name : address?.addressCountry;
  const apply = $('a[href], button, input[type="submit"]').toArray().some(el => /apply/i.test($(el).text() || $(el).attr('value') || '') && !$(el).is('[disabled]'));
  if (!t || !closesAt || (!apply && !activeFeed)) throw new Error('Vacancy title, closing date or application control could not be verified');
  return { t, u: url, l: clean(address?.addressLocality || field('Location')), country: country || field('Country'), closesAt,
    description: structured?.description ? htmlText(structured.description) : text, salary: field('Salary') };
}

export function parsePressList(html, base) {
  const $ = load(html), links = new Set();
  $('a[href]').each((_, a) => {
    const u = new URL($(a).attr('href'), base);
    if (u.origin === new URL(base).origin && /\/jobs\/vacancy\/[^/]+\/\d+\/description\//.test(u.pathname)) links.add(u.href);
  });
  if (!links.size && !/no (?:matching )?(?:vacancies|jobs|results)|0 vacancies/i.test($.text())) throw new Error('Careers search could not be read; open the employer site to check');
  return { links: [...links], next: $('a[rel="next"], .pagination .next a, a.next').first().attr('href') };
}

async function paged(url, parse, fetcher) {
  const items = [], seen = new Set(); let next = url;
  while (next) {
    if (seen.has(next) || seen.size >= 30) throw new Error('Source pagination could not be completed');
    if (new URL(next).origin !== new URL(url).origin) throw new Error('Unexpected pagination destination');
    seen.add(next);
    const page = parse(await fetcher(next), next); items.push(...(page.jobs || page.links));
    next = page.next ? new URL(page.next, next).href : null;
  }
  return items;
}

export async function collectSource(source, fetcher = get) {
  if (source.type === 'greenhouse') {
    const data = await fetcher(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(source.board)}/jobs?content=true`, true);
    if (!Array.isArray(data.jobs)) throw new Error('Invalid employer job feed');
    return { jobs: data.jobs.map(j => ({ t: j.title, u: safeURL(j.absolute_url), l: j.location?.name || '',
      description: htmlText(j.content), evidence: 'Published in employer’s active Greenhouse job feed' })), seen: data.jobs.length };
  }
  if (source.type === 'cambridge-university') {
    const all = await paged(source.url, parseUniversity, fetcher);
    const candidates = all.filter(j => matchRole(j.t) && closingTime(j.closesAt) > Date.now());
    let failed = 0;
    const jobs = await mapLimit(candidates, 3, async job => {
      try {
        const $ = load(await fetcher(job.u)); const main = $('main');
        const text = clean(main.text() || $('body').text());
        if (/no longer accepting|vacancy (?:has |is )?closed|job has expired/i.test(text)) return null;
        if (!clean($('h1').text()).includes(job.t) || !/apply (?:online|now)|application (?:form|system)/i.test(text)) throw new Error('Job detail lacks active application evidence');
        return { ...job, description: text, evidence: 'Listed on employer search and application page checked' };
      } catch { failed++; return null; }
    });
    return { jobs: jobs.filter(Boolean), seen: all.length, failed };
  }
  if (source.type === 'cambridge-press') {
    const urls = await paged(source.url, parsePressList, fetcher); let failed = 0;
    const jobs = await mapLimit([...new Set(urls)], 3, async url => {
      try { const j = parsePressJob(await fetcher(url), url); return j ? { ...j, evidence: 'Employer vacancy page with application control and closing date' } : null; }
      catch { failed++; return null; }
    });
    return { jobs: jobs.filter(Boolean), seen: urls.length, failed };
  }
  throw new Error(`Unsupported source type: ${source.type}`);
}

export function sponsorKey(source, register) {
  // Explicit legal names only. Never fuzzy-match a recruiter or similarly named business.
  const norm = s => s.trim().replace(/\s+/g, ' ').toLowerCase();
  const matches = register.orgs.filter(o => norm(o[0]) === norm(source.sponsorName) && (!source.sponsorTown || norm(o[1]) === norm(source.sponsorTown)));
  if (matches.length !== 1) throw new Error(`Sponsor mapping requires one exact register match; found ${matches.length}`);
  return matches[0][0].toLowerCase() + '|' + matches[0][1].toLowerCase();
}
