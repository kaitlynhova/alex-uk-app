import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { chromium } from 'playwright';
import { collectCambridgePress } from '../lib/cambridge-browser.mjs';

const port = 3197, base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: String(port) }, stdio: 'pipe' });
let serverOutput = '';
server.stderr.on('data',d => serverOutput += d);
let browser;
try {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(base)).ok) break; } catch { /* Wait for local server. */ }
    if (i === 79) throw new Error('Test server did not start: ' + serverOutput);
    await new Promise(r => setTimeout(r, 100));
  }
  try { browser = await chromium.launch(); } catch { browser = await chromium.launch({ channel: 'chrome' }); }
  const now = Date.now();
  const name = 'Cambridge University Press & Assessment', key = name.toLowerCase() + '|cambridge';
  const job = (t,id,extra={}) => ({ t, u:`https://careers.cambridge.org/jobs/${id}`, l:'Cambridge, UK', country:'UK', e:name, status:'open', evidence:'Employer application checked', verifiedAt:new Date(now-1000).toISOString(), expiresAt:new Date(now+3600000).toISOString(), ...extra });
  const register = { date:'2026-10-23', rows:3, routes:['Skilled Worker'], orgs:[[name,'Cambridge','',[[0,'A']]],['Research Only','London','',[[0,'A']]],['London Legal Office','London','',[[0,'A']]]] };
  const snapshot = {schemaVersion:2,generatedAt:new Date(now).toISOString(),expiresAt:new Date(now+3600000).toISOString(),sources:[{id:'cup',key,name,url:'https://careers.cambridge.org/jobs/vacancy/find/results/',status:'ok',matched:8}],orgs:{[key]:[
    job('Executive Communications Director','exec'),job('Senior Marketing Manager','senior'),job('Content Strategist','content'),...Array.from({length:5},(_,i)=>job('Marketing Executive '+i,'marketing'+i)),
    job('Clinical Research Associate','clinical'),job('Marketing Manager','expired',{closesAt:'2020-01-01'}),job('Marketing Manager','india',{country:'India',l:'Delhi'})
  ],'research only|london':[job('Clinical Research Associate','research')],'london legal office|london':[job('Content Marketing Manager','other',{e:'London Legal Office'})]}};
  const errors=[];
  const context=await browser.newContext({ viewport:{width:1440,height:1000} });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/register.json',r=>r.fulfill({json:register}));
  await context.route('**/hiring.json',r=>r.fulfill({json:snapshot}));
  await page.goto(base);await page.locator('.org').first().waitFor();
  assert.equal(await page.locator('.org').count(),2);
  assert.equal(await page.locator('.jobs a').count(),9,'Each relevant role, including collapsed roles, should be available');
  assert.equal(await page.locator('.jobs').getByText('Clinical Research Associate').count(),0);
  assert.equal(await page.locator('a[href$="/expired"], a[href$="/india"]').count(),0);
  await page.getByRole('button',{name:'Executive communications',exact:true}).click();
  assert.equal(await page.locator('.jobs a').count(),1,'Role focus must filter the postings themselves');
  await page.getByRole('button',{name:'Reset filters'}).click();
  await page.locator('#senioronly').check();assert.equal(await page.locator('.jobs a').count(),2);
  await page.getByRole('button',{name:'Reset filters'}).click();
  await page.locator('#townchips').getByRole('button',{name:'Cambridge',exact:true}).click();
  assert.equal(await page.locator('.org').count(),2,'Use vacancy location even for sponsor registered in London');
  await page.locator('#q').fill('Cambridge University');
  await page.waitForFunction(()=>document.querySelectorAll('.org').length===1);
  await page.locator('.star').click();await page.locator('#tab-saved').click();assert.equal(await page.locator('.org').count(),1);
  await page.reload();await page.locator('.org').first().waitFor();assert.equal(await page.locator('#savedn').innerText(),'(1)');
  await page.getByRole('button',{name:'Load a newer register'}).click();
  await page.locator('#file').setInputFiles({name:'register-2026-10-23.csv',mimeType:'text/csv',buffer:Buffer.from('Organisation Name,Town/City,County,Type & Rating,Route\n"'+name+'",Cambridge,,Worker (A rating),Skilled Worker\n')});
  await page.waitForFunction(()=>document.querySelector('#fileinfo').textContent.includes('Your file'));
  await page.reload();await page.locator('.org').first().waitFor();assert.equal(await page.locator('.jobs a').count(),8,'Restored CSV must also load vacancy evidence');
  await context.route('**/api/refresh',r=>r.fulfill({json:{...snapshot,orgs:{},sources:[{...snapshot.sources[0],status:'unavailable',matched:0,message:'Source unavailable'}]}}));
  await page.getByRole('button',{name:'Refresh live jobs'}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.org').length===0);
  assert.ok((await page.locator('#coverage-list').textContent()).includes('Could not verify'));
  await context.close();

  for (const mode of ['missing','stale','legacy']) {
    const c=await browser.newContext();const p=await c.newPage();
    await c.route('**/register.json',r=>r.fulfill({json:register}));
    await c.route('**/hiring.json',r=>mode==='missing'?r.fulfill({status:503,body:'Unavailable'}):r.fulfill({json:mode==='legacy'?{orgs:snapshot.orgs}: {...snapshot,expiresAt:'2020-01-01',orgs:{[key]:[job('Marketing Manager','old',{verifiedAt:'2020-01-01',expiresAt:'2020-01-02'})]}}}));
    await p.goto(base);await p.locator('#results').waitFor();
    assert.equal(await p.locator('.org').count(),0,`${mode} feed must fail closed`);
    await p.locator('#hiringonly').uncheck();assert.equal(await p.locator('.org').count(),3);
    assert.equal(await p.locator('.jobs a').count(),0);
    await c.close();
  }
  const mobile=await browser.newContext({viewport:{width:390,height:844}});const mp=await mobile.newPage();
  await mobile.route('**/register.json',r=>r.fulfill({json:register}));await mobile.route('**/hiring.json',r=>r.fulfill({json:snapshot}));
  await mp.goto(base);await mp.locator('.org').first().waitFor();
  assert.equal(await mp.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Mobile layout should not scroll horizontally');
  await mobile.close();assert.deepEqual(errors,[]);
  console.log('Browser checks passed: filtering, expiry, failed refresh, missing feed, cached CSV, saving and mobile layout.');

  // Exercise the actual browser collector against a JavaScript-paginated eArcu fixture.
  const fixture=http.createServer((req,res)=>{
    res.setHeader('Content-Type','text/html');
    if(req.url==='/search')res.end(`<h1>Job search</h1><div id="rows"><a href="/jobs/vacancy/research/1/description/">Research Associate</a></div><a href="#" class="scroller_movenext" onclick="const a=document.querySelector('#rows a');a.href='/jobs/vacancy/marketing/2/description/';a.textContent='Marketing Manager';this.remove();return false;">Next</a>`);
    else res.end('<main><h1>Marketing Manager</h1><p>Location: Cambridge Country: UK Business Unit: Academic Vacancy Type: Permanent Closing Date: 1 December 2099 Job Title: Marketing Manager</p><a href="/apply/2">Apply now</a></main>');
  });
  await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
  try {const result=await collectCambridgePress({url:`http://127.0.0.1:${fixture.address().port}/search`});assert.equal(result.seen,2);assert.equal(result.jobs.length,1);assert.equal(result.failed,0);assert.equal(result.jobs[0].t,'Marketing Manager');console.log('Cambridge browser pagination check passed: relevant role found on page two.');}
  finally {await new Promise(r=>fixture.close(r));}
} finally {
  await browser?.close(); server.kill();
}
