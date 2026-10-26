import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
const filename = process.argv[2];
if (!filename) throw new Error('Usage: npm run import-register -- path/to/register-YYYY-MM-DD.csv');
const text = await readFile(filename, 'utf8');
// RFC 4180 fields, including escaped quotes and embedded newlines.
const rows = []; let row = [], field = '', quoted = false;
for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
  const c = text[i];
  if (quoted) { if (c === '"' && text[i+1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c; }
  else if (c === '"') quoted = true;
  else if (c === ',') { row.push(field); field = ''; }
  else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
  else if (c !== '\r') field += c;
}
if (quoted) throw new Error('Unterminated CSV field');
if (field || row.length) { row.push(field); rows.push(row); }
const headers = rows.shift().map(s => s.trim());
const columns = ['Organisation Name','Town/City','County','Type & Rating','Route'].map(name => headers.indexOf(name));
if (columns.includes(-1)) throw new Error('Missing required register columns');
const orgs = new Map(), routes = []; let count = 0;
for (const row of rows) {
  const [name,town,county,type,route] = columns.map(i => (row[i] || '').trim()); if (!name) continue; count++;
  if (!routes.includes(route)) routes.push(route);
  const key = name.toLowerCase() + '|' + town.toLowerCase();
  if (!orgs.has(key)) orgs.set(key,[name,town,county,[]]);
  orgs.get(key)[3].push([routes.indexOf(route), type.match(/\b([AB]) rating/i)?.[1].toUpperCase() || '']);
}
const date = basename(filename).match(/\d{4}-\d{2}-\d{2}/)?.[0];
if (!date) throw new Error('Include the register publication date (YYYY-MM-DD) in its filename');
await writeFile(new URL('../register.json', import.meta.url), JSON.stringify({ date, source: basename(filename), rows: count, routes, orgs: [...orgs.values()] }));
console.log(`Imported ${count} licence rows and ${orgs.size} organisations, dated ${date}.`);
