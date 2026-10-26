import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePressJob, parsePressList, parseUniversity, sponsorKey, collectSource, htmlText } from '../lib/sources.mjs';
import { reviewFingerprint, reviewedJob } from '../lib/job-reviews.mjs';
import { refreshJobs } from '../scripts/refresh-jobs.mjs';
import { collectICIMS } from '../lib/regional-sources.mjs';

const pressURL='https://careers.cambridge.org/jobs/vacancy/social-media-manager-cambridge/123/description/';
const pressHTML=`<main><h1>Social Media Manager</h1><ul><li>Salary: £45,000</li><li>Location: Cambridge</li><li>Country: UK</li><li>Business Unit: Academic</li><li>Vacancy Type: Permanent</li><li>Closing Date: 25 October 2026</li></ul><p>Job Title: Social Media Manager</p><a href="/apply/123">Apply now</a></main>`;
test('reads Cambridge eArcu vacancy fields and requires application evidence',()=>{
  const j=parsePressJob(pressHTML,pressURL);
  assert.equal(j.closesAt,'2026-10-25');assert.equal(j.l,'Cambridge');assert.equal(j.country,'UK');assert.equal(j.t,'Social Media Manager');
  assert.throws(()=>parsePressJob(pressHTML.replace('Apply now',''),pressURL));
  assert.equal(parsePressJob(pressHTML+'<main>This vacancy is closed</main>',pressURL),null);
});
test('handles structured JobPosting data and rejects generic careers pages',()=>{
  const html='<h1>Executive Communications Lead</h1><a href="/apply/123">Apply now</a><script type="application/ld+json">'+JSON.stringify({'@graph':[{'@type':'JobPosting',title:'Executive Communications Lead',validThrough:'2026-11-02',jobLocation:{address:{addressLocality:'London',addressCountry:'GB'}}}]})+'</script>';
  assert.equal(parsePressJob(html,pressURL).country,'GB');
  assert.throws(()=>parsePressJob('<h1>Careers</h1><a>Apply now</a>',pressURL));
  assert.throws(()=>parsePressList('<h1>Please enable JavaScript</h1>',pressURL));
});
test('extracts direct links and does not treat unreadable HTML as no jobs',()=>{
  const result=parsePressList(`<a href="${pressURL}">Role</a><a href="${pressURL}">Duplicate</a><a href="https://attacker.example/jobs/vacancy/test/2/description/">Other</a>`,pressURL);
  assert.deepEqual(result.links,[pressURL]);
  assert.throws(()=>parseUniversity('<h1>Temporarily unavailable</h1>','https://www.cam.ac.uk'));
});
test('exact legal sponsor mapping rejects fuzzy and ambiguous matches',()=>{
  const register={orgs:[['Cambridge University Press & Assessment','Cambridge','',[]],['Cambridge Recruitment Ltd','London','',[]]]};
  assert.equal(sponsorKey({sponsorName:'cambridge university press & assessment'},register),'cambridge university press & assessment|cambridge');
  assert.throws(()=>sponsorKey({sponsorName:'Cambridge'},register));
  assert.throws(()=>sponsorKey({sponsorName:'Cambridge University Press & Assessment'},{orgs:[...register.orgs,register.orgs[0]]}));
});
test('collector follows all university pages and verifies detail pages',async()=>{
  const row=(id,title)=>`<table><tr><td class="views-field-title"><a href="/jobs/${id}">${title}</a></td><td class="views-field-field-closing-date"><time datetime="2099-11-03T00:00:00Z"></time></td></tr></table>`;
  const seen=[];
  const fetcher=async url=>{seen.push(url);if(url.endsWith('/search'))return row('1','Research Associate')+'<a rel="next" href="/search?page=2">Next</a>';if(url.includes('?page=2'))return row('2','Marketing Manager');return '<main><h1>Marketing Manager</h1><a>Apply online</a></main>';};
  const result=await collectSource({type:'cambridge-university',url:'https://www.cam.ac.uk/search'},fetcher);
  assert.equal(result.seen,2);assert.equal(result.jobs.length,1);assert.equal(result.failed,0);assert.equal(seen.length,3);
});
test('refresh reports partial and failed sources without keeping unverifiable jobs',async()=>{
  const sources=[{id:'ok',name:'Good',sponsorName:'Good'},{id:'bad',name:'Blocked',sponsorName:'Blocked'},{id:'partial',name:'Partial',sponsorName:'Partial'},{id:'unmapped',name:'Unknown',sponsorName:'Unknown'}];
  const register={orgs:['Good','Blocked','Partial'].map(n=>[n,'London','',[]])};
  const now=Date.parse('2026-10-26T12:00:00Z');
  const collector=async s=>{if(s.id==='bad')throw new Error('HTTP 403');return{seen:3,failed:s.id==='partial'?1:0,jobs:[{t:'Marketing Manager',l:'London',u:'https://example.org/'+s.id,evidence:'Active employer feed'},{t:'Clinical Researcher',l:'London',u:'https://example.org/research',evidence:'Active feed'},{t:'Content Manager',l:'Manila',country:'PH',u:'https://example.org/manila',evidence:'Active feed'}]};};
  const data=await refreshJobs({sources,register,collector,now,output:null});
  assert.equal(Object.values(data.orgs).flat().length,2);
  assert.deepEqual(data.sources.map(s=>s.status),['ok','unavailable','partial','unavailable']);
  assert.equal(data.orgs['blocked|london'],undefined);
  assert.equal(data.orgs['good|london'][0].verifiedAt,new Date(now).toISOString());
});

test('Irish jobs survive refresh without being presented as UK locations',async()=>{
  const now=Date.parse('2026-10-26T12:00:00Z');
  const data=await refreshJobs({now,output:null,sources:[{id:'group',name:'Group',sponsorName:'Group UK Ltd'}],register:{orgs:[['Group UK Ltd','London','',[]]]},collector:async()=>({seen:3,jobs:[
    {t:'Marketing Manager',l:'Dublin',country:'IE',u:'https://example.org/ie',evidence:'Active feed'},
    {t:'Content Strategist',l:'Glasgow',u:'https://example.org/gb',evidence:'Active feed'},
    {t:'Marketing Manager',l:'Dublin, CA',country:'US',u:'https://example.org/us',evidence:'Active feed'}]})});
  assert.equal(data.orgs['group uk ltd|london'].length,2);
  assert.deepEqual(data.sources[0].regions,{scotland:1,ireland:1,'northern-ireland':0});
  assert.equal(data.sources[0].outsideSupportedLocations,1);
});
test('iCIMS scans every page and requires active application flags plus a matching detail page',async()=>{
  const source={url:'https://careers.example.org/jobs'};
  const entry=(id,title,applyable=true)=>({data:{req_id:id,title,applyable,searchable:true,internal:false,full_location:'Dublin, Ireland',country_code:'IE',meta_data:{canonical_url:'https://careers.example.org/jobs/'+id}}});
  const fetcher=async url=>{
    if(url.includes('/api/'))return{totalCount:3,jobs:url.includes('page=1')?[entry('1','Engineer')]:[entry('2','Thought Leadership Lead'),entry('3','Marketing Manager',false)]};
    return '<script type="application/ld+json">'+JSON.stringify({'@type':'JobPosting',title:'Thought Leadership Lead',validThrough:'2099-11-02',jobLocation:{address:{addressLocality:'Dublin',addressCountry:'Ireland'}}})+'</script>';
  };
  const data=await collectICIMS(source,fetcher);
  assert.equal(data.seen,3);assert.equal(data.jobs.length,1);assert.equal(data.jobs[0].country,'Ireland');assert.equal(data.failed,0);
  await assert.rejects(()=>collectICIMS(source,async()=>({totalCount:2,jobs:[entry('1','Engineer')]})),/pagination stalled/);
});
test('descriptions decode HTML entities and preserve word boundaries',()=>{
  assert.equal(htmlText('&lt;p&gt;Own thought leadership&lt;/p&gt;&lt;p&gt;Write executive communications&lt;/p&gt;'),'Own thought leadership Write executive communications');
});
test('review notes are invalidated when the job changes',()=>{
  const j={t:'Marketing Manager',l:'Dublin',country:'IE',description:'Own AI content strategy.',u:'https://example.org/job'};
  const reviews={[j.u]:{fingerprint:reviewFingerprint(j),summary:'Related experience',caveat:'Confirm requirements'}};
  assert.equal(reviewedJob(j,reviews).review.summary,'Related experience');
  assert.equal(reviewedJob({...j,l:'New York'},reviews).review,undefined);
  assert.equal(reviewedJob({...j,description:'New requirements'},reviews).review,undefined);
});
