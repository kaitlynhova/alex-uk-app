import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { refreshJobs } from './scripts/refresh-jobs.mjs';

const port = Number(process.env.PORT || 3000);
const files = { '/': ['index.html','text/html'], '/index.html': ['index.html','text/html'], '/app.mjs': ['app.mjs','text/javascript'], '/job-policy.mjs': ['job-policy.mjs','text/javascript'], '/register.json': ['register.json','application/json'], '/hiring.json': ['hiring.json','application/json'] };
let running, lastRefresh = 0;
function refresh() {
  if (!running) running = refreshJobs().then(data => { lastRefresh = Date.now(); return data; }).finally(() => { running = null; });
  return running;
}
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, `http://localhost:${port}`).pathname;
  const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(body); };
  try {
    if (pathname === '/api/refresh' && req.method === 'POST') {
      if (req.headers.origin && ![`http://localhost:${port}`, `http://127.0.0.1:${port}`].includes(req.headers.origin)) return send(403, '{"error":"Use the local app to refresh"}');
      if (!running && Date.now() - lastRefresh < 60000) return send(200, await readFile(new URL('hiring.json', import.meta.url)));
      return send(200, JSON.stringify(await refresh()));
    }
    if (!['GET', 'HEAD'].includes(req.method)) return send(405, '{"error":"Method not allowed"}');
    const file = files[pathname];
    if (!file) return send(404, '{"error":"Not found"}');
    return send(200, req.method === 'HEAD' ? '' : await readFile(new URL(file[0], import.meta.url)), file[1]);
  } catch (e) { console.error(e.message); send(500, '{"error":"Refresh failed. Please try again."}'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Sponsor Finder: http://localhost:${port}`));
async function refreshIfNeeded() {
  try { const data = JSON.parse(await readFile(new URL('hiring.json', import.meta.url))); if (Date.now() - Date.parse(data.generatedAt) < 6 * 3600000) return; } catch { /* Initial collection. */ }
  await refresh().catch(e => console.error('Refresh failed:', e.message));
}
void refreshIfNeeded();
setInterval(refreshIfNeeded, 3600000).unref();
