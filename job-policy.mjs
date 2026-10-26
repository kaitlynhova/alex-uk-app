// Shared by the collector and browser so stale data cannot bypass the filters.
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const CATEGORIES = ['Marketing', 'Thought leadership', 'Executive communications', 'Content strategy', 'Communications'];

export function safeURL(value) {
  try { const u = new URL(value); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; }
}

export function matchRole(title = '', description = '') {
  const t = title.toLowerCase();
  // A marketing department or an incidental mention of communications is not a job function.
  if (/\b(clinical|postdoc\w*|professor|lecturer|studentship|phd|engineer|technician|architect|technical program manager|sales|account executive|account manager|merchandis\w*|executive assistant|personal assistant|recruiter|talent acquisition|intern|internship|apprentice\w*|training programme|content moderator|content moderation|designer)\b/.test(t) || /^(?:lead |senior )?engagement manager\b/.test(t)) return null;
  const categories = [], reasons = [];
  const add = (category, reason) => { categories.push(category); reasons.push(reason); };
  if (/\b(marketing|brand (manager|lead|director|strategist|strategy)|seo|demand generation|growth campaigns|paid media|digital channels)\b/.test(t)) add('Marketing', 'Marketing, positioning or campaign ownership');
  if (/\b(thought leadership|thought leader|research[- ]led content)\b/.test(t)) add('Thought leadership', 'Thought leadership and research-led storytelling');
  if (/\b(executive|leadership|ceo|c-suite)\b.*\b(comm(?:unication)?s?|communication|ghostwrit\w*|speechwrit\w*)\b|\b(ghostwrit\w*|speechwrit\w*)\b/.test(t)) add('Executive communications', 'Executive voice, speeches or ghostwriting');
  if (/\b(content (?:marketing|strateg\w*|lead|manager|director|editor)|(?:head|director|manager) of (?:content|editorial)|editorial (?:lead|strateg\w*|director|manager)|managing editor|copywriter|brand (?:narrative|storytell\w*)|social (?:media|& content))\b/.test(t)) add('Content strategy', 'Content strategy, editorial or brand storytelling');
  if (/\b(communications?|comms|public relations|media relations|press officer|head of media)\b/.test(t)) add('Communications', 'Corporate, external or internal communications');
  if (!categories.length) return null;
  if (/\bthought leadership\b/i.test(description) && !categories.includes('Thought leadership')) add('Thought leadership', 'The role description includes thought leadership');
  if (/\b(executive communications|executive voice|ghostwriting|speechwriting)\b/i.test(description) && !categories.includes('Executive communications')) add('Executive communications', 'The role description includes executive storytelling');
  const senior = /\b(senior|lead|head|director|principal|vp|chief)\b/.test(t);
  const strategic = categories.some(c => ['Content strategy', 'Thought leadership', 'Executive communications'].includes(c));
  return { categories, reasons, score: 50 + (strategic ? 25 : 0) + (senior ? 15 : 0), level: senior ? 'Senior / leadership' : 'Other levels' };
}

export function isUKLocation(location = '', country = '') {
  if (country) return /^(gb|gbr|uk|united kingdom|great britain)$/i.test(country.trim());
  if (/\b(ontario|canada|kentucky|massachusetts|united states|\bUSA\b)\b/i.test(location) && !/united kingdom|\bUK\b/i.test(location)) return false;
  const unambiguous = location.replace(/\bnew york\b/gi, '').replace(/\b(?:cambridge|london|oxford|manchester|birmingham|reading|bristol|brighton|newcastle|york)\s*,\s*(?:MA|CA|NY|NJ|TX|AL|PA|NH|CT|ON|OH|MI|VA|WA|Australia|New Zealand)\b/gi, '');
  return /\b(united kingdom|great britain|uk|england|scotland|wales|northern ireland|london|cambridge|oxford|edinburgh|glasgow|manchester|bristol|birmingham|leeds|cardiff|belfast|nottingham|reading|brighton|newcastle|sheffield|liverpool|bath|exeter|york|southampton|watford|hertford|carshalton)\b/i.test(unambiguous);
}

export function closingTime(value) {
  if (!value) return null;
  // A date-only closing date lasts through that date in Britain (including BST).
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const end = Date.parse(`${value}T23:59:59.999Z`);
    const londonHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23' }).format(new Date(end)));
    return end - (londonHour === 0 ? 3600000 : 0);
  }
  return Date.parse(value);
}

export function isActiveJob(job, now = Date.now()) {
  const checked = Date.parse(job.verifiedAt);
  const expires = Date.parse(job.expiresAt);
  const closes = closingTime(job.closesAt);
  return job.status === 'open' && !!job.evidence && !!safeURL(job.u) && !!job.t &&
    Number.isFinite(checked) && checked <= now && now - checked < MAX_AGE_MS &&
    Number.isFinite(expires) && expires > now &&
    (!job.closesAt || (Number.isFinite(closes) && closes > now)) &&
    isUKLocation(job.l, job.country) && !!matchRole(job.t, job.description);
}

export function visibleJobs(jobs = [], { now = Date.now(), categories = [], seniorOnly = false } = {}) {
  const seen = new Set();
  return jobs.filter(j => {
    if (!isActiveJob(j, now)) return false;
    const match = matchRole(j.t, j.description);
    if (seniorOnly && match.level !== 'Senior / leadership') return false;
    if (categories.length && !categories.some(c => match.categories.includes(c))) return false;
    const key = safeURL(j.u).split('#')[0];
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).sort((a, b) => matchRole(b.t, b.description).score - matchRole(a.t, a.description).score);
}
