import test from 'node:test';
import assert from 'node:assert/strict';
import { matchRole, isActiveJob, visibleJobs, closingTime, isUKLocation, MAX_AGE_MS } from '../job-policy.mjs';

const now = Date.parse('2026-10-26T12:00:00Z');
const job = overrides => ({ t: 'Senior Content Marketing Manager', l: 'London', u: 'https://example.org/jobs/123', status: 'open', evidence: 'Employer active feed', verifiedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 3600000).toISOString(), ...overrides });

test('matches Alex’s actual disciplines and explains the match', () => {
  for (const title of ['Senior Content Marketing Manager','Executive Communications Lead','Thought Leadership Director','Brand Manager','Copywriter','Marketing Executive','Social Media Manager','Communications and Community Engagement Manager']) assert.ok(matchRole(title), title);
  assert.ok(matchRole('Content Strategist','Own thought leadership and executive communications.').categories.includes('Executive communications'));
  assert.ok(matchRole('Thought Leadership Director').score > matchRole('Marketing Executive').score);
});
test('excludes old false positives and incidental marketing words', () => {
  for (const title of ['Senior Clinical Research Associate','Branded Sales Account Manager','Assistant Merchandiser - Own Brand','Research Consultant','Learning & Development Manager','Project Manager Training Programme','Marketing Data Engineer','Executive Assistant, Growth Marketing','Postdoctoral Research Associate in Marketing','Content Moderator','Senior Designer']) assert.equal(matchRole(title, 'We collaborate with marketing, thought leadership and communications.'), null, title);
});
test('requires positive recent evidence; never trusts a snapshot date alone', () => {
  assert.equal(isActiveJob(job(), now), true);
  for (const overrides of [{verifiedAt:undefined},{verifiedAt:'bad'},{verifiedAt:new Date(now+1).toISOString()},{verifiedAt:new Date(now-MAX_AGE_MS).toISOString()},{expiresAt:'bad'},{expiresAt:new Date(now).toISOString()},{status:'closed'},{evidence:''},{u:'javascript:alert(1)'},{u:'https://example.org',t:'Research Consultant'}]) assert.equal(isActiveJob(job(overrides), now), false, JSON.stringify(overrides));
});
test('rejects expired or malformed deadlines, including Cambridge’s previous-day advert', () => {
  assert.equal(isActiveJob(job({closesAt:'2026-10-25'}),now),false);
  assert.equal(isActiveJob(job({closesAt:'bad date'}),now),false);
  assert.equal(isActiveJob(job({closesAt:'2026-10-26'}),now),true);
  assert.equal(closingTime('2026-06-01'),Date.parse('2026-06-01T22:59:59.999Z'));
  assert.equal(closingTime('2026-12-01'),Date.parse('2026-12-01T23:59:59.999Z'));
});
test('uses actual job country and location, never the sponsor’s office', () => {
  assert.equal(isUKLocation('Cambridge','UK'),true);
  assert.equal(isUKLocation('Cambridge','US'),false);
  assert.equal(isUKLocation('London, Ontario'),false);
  assert.equal(isUKLocation('Remote'),false);
  assert.equal(isUKLocation('Remote (UK)'),true);
  for (const location of ['New York, NY','San Francisco, CA | New York City, NY','Remote - New York','Cambridge, MA','Birmingham, AL','London, ON','Reading, PA']) assert.equal(isUKLocation(location),false,location);
  assert.equal(isUKLocation('New York, NY | London'),true);
  assert.equal(isUKLocation('York, England'),true);
  assert.equal(isActiveJob(job({l:'Manila',country:'Philippines'}),now),false);
});
test('filters individual roles by discipline and level, and deduplicates links', () => {
  const jobs = [job(),job(),job({t:'Marketing Executive',u:'https://example.org/2'}),job({t:'Executive Communications Director',u:'https://example.org/3'})];
  assert.equal(visibleJobs(jobs,{now}).length,3);
  assert.equal(visibleJobs(jobs,{now,seniorOnly:true}).length,2);
  assert.equal(visibleJobs(jobs,{now,categories:['Executive communications']}).length,1);
});
