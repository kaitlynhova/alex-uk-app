import { readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { collectSource, mapLimit, sponsorKey } from '../lib/sources.mjs';
import { collectCambridgePress } from '../lib/cambridge-browser.mjs';
import { MAX_AGE_MS, matchRole, visibleJobs, closingTime, isUKLocation } from '../job-policy.mjs';

const root = new URL('../', import.meta.url);
export async function refreshJobs({ sources, register, collector = source => source.type === 'cambridge-press' ? collectCambridgePress(source) : collectSource(source), now = Date.now(), output = new URL('hiring.json', root) } = {}) {
  sources ??= JSON.parse(await readFile(new URL('sources.json', root), 'utf8'));
  register ??= JSON.parse(await readFile(new URL('register.json', root), 'utf8'));
  const verifiedAt = new Date(now).toISOString(), expiresAt = new Date(now + MAX_AGE_MS).toISOString();
  const orgs = {}, coverage = [];
  await mapLimit(sources, 3, async source => {
    const status = { id: source.id, name: source.name, url: source.url, checkedAt: verifiedAt };
    try {
      const key = sponsorKey(source, register); status.key = key;
      const result = await collector(source);
      const relevant = result.jobs.filter(j => matchRole(j.t,j.description));
      status.expired = relevant.filter(j => isUKLocation(j.l,j.country) && j.closesAt && closingTime(j.closesAt) <= now).length;
      status.outsideUK = relevant.filter(j => !isUKLocation(j.l,j.country)).length;
      const jobs = visibleJobs(result.jobs.map(j => ({ ...j, e: source.name, sourceId: source.id, status: 'open', verifiedAt, expiresAt, match: matchRole(j.t, j.description) })), { now });
      // Rebuild from current evidence. A failed source never keeps old postings marked as open.
      if (jobs.length) orgs[key] = visibleJobs([...(orgs[key] || []), ...jobs], { now });
      Object.assign(status, { status: result.failed ? 'partial' : 'ok', seen: result.seen, matched: jobs.length,
        message: result.failed ? `${result.failed} vacancy pages could not be verified` : '' });
    } catch (error) { Object.assign(status, { status: 'unavailable', matched: 0, message: error.message }); }
    coverage.push(status);
  });
  coverage.sort((a,b) => sources.findIndex(s => s.id === a.id) - sources.findIndex(s => s.id === b.id));
  const snapshot = { schemaVersion: 2, generatedAt: verifiedAt, expiresAt, maxAgeHours: 24, profileURL: 'https://alexandracannon.com/', orgs, sources: coverage };
  if (output) { const path = output instanceof URL ? fileURLToPath(output) : output; await writeFile(path + '.tmp', JSON.stringify(snapshot, null, 2) + '\n'); await rename(path + '.tmp', path); }
  return snapshot;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const data = await refreshJobs();
  for (const s of data.sources) console.log(`${s.name}: ${s.status} · ${s.matched} relevant live roles${s.message ? ' · ' + s.message : ''}`);
  console.log(`Saved ${Object.values(data.orgs).flat().length} verified UK roles.`);
  if (data.sources.every(s => s.status === 'unavailable')) process.exitCode = 1;
}
