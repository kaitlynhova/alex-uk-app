# Alex Cannon UK & Ireland Job Finder

An update of the attached app, using the supplied Home Office register dated **23 October 2026** (143,205 licence rows). Job matching follows [Alex’s portfolio](https://alexandracannon.com/): marketing, content strategy, thought leadership, executive voice and communications. The original styling, sponsor search, saved employers and CSV upload remain available.

## Run locally

Requires Node.js 22 or later:

```sh
npm ci
npx playwright install chromium
npm start
```

Open **http://localhost:3000**. The bundled verified snapshot loads immediately. **Refresh live jobs** checks all configured employers again. While the server runs, it checks hourly whether the snapshot is over six hours old and refreshes it if needed. Cambridge Press uses a normal headless browser to render its JavaScript results and click every page. If bundled Chromium is unavailable, installed Google Chrome is used as a fallback.

## What counts as a verified match

- Published on an employer’s active job API, or found on an employer search with a checked vacancy detail and application control.
- Mapped to one exact legal sponsor name in the register; ambiguous matches are rejected.
- A UK or Republic of Ireland job location (not the employer’s registered address). Remote jobs need an explicit supported country; generic EMEA, Europe or worldwide remote locations do not establish eligibility.
- A relevant role title; responsibilities can strengthen a content, thought leadership or executive communications match. Incidental words in an unrelated description do not qualify a role.
- Checked within 24 hours, with no elapsed closing date. Date-only deadlines use the end of that date in Britain.

Expired, closed, unverified and jobs outside the UK and Ireland do not appear in verified results. Failed sources are labelled separately and their old jobs are removed. Every result links directly to its posting and shows a match reason and check time. A job can still close between checks; a sponsor licence does not establish sponsorship availability for that role.

## Coverage and limitations

`sources.json` explicitly configures **17 employers**, including Cambridge University Press & Assessment, University of Cambridge, Anthropic, Monzo, Figma, Culture Amp, Duolingo, Coursera, Trustpilot, HubSpot, FanDuel, Susquehanna and Right There. This is **not a complete vacancy search across the 127,840 organisations in the register**. The coverage panel identifies sources that have no matching roles versus sources that could not be checked. Turning off the verified filter lets you browse other sponsors, labelled as unchecked.

Add a public Greenhouse board to `sources.json` using its board token and the exact `sponsorName` from the register. If the legal name has multiple locations, specify `sponsorTown`. Susquehanna’s iCIMS feed is paginated completely and matching details are verified; Right There uses browser pagination plus structured vacancy details. Other career systems need an adapter; there is no speculative employer-name or recruitment-agency matching. Matching is a deterministic screen, not a complete assessment of suitability. The senior-only option looks for senior, lead, head, director, principal, VP or chief in titles; managerial roles without those words remain available with it off.

## Refresh or replace data

```sh
npm run refresh
npm run import-register -- /path/to/register-YYYY-MM-DD.csv
npm run refresh
```

Refresh rewrites `hiring.json` atomically. It collects each source independently, removes previous data instead of perpetuating stale jobs, and reports incomplete or blocked sources. The browser also enforces expiry on load, each minute and when the tab becomes visible. Existing browser-uploaded registers load vacancy data as well; upload affects that browser only, while the import command updates the collector’s register.

The files can be served statically, but live refresh requires the included Node server. For static hosting, run the refresh command on a schedule and publish the updated `hiring.json` at least daily. Static copies deliberately stop showing expired verification data. Do not open `index.html` as a `file://` URL; serve it over HTTP.

## Checks

```sh
npm test
npm run test:browser
```

Tests cover role relevance, UK and Irish locations, Scottish cities and UK-wide remote eligibility, Northern Ireland separation, combined regional filters, deadlines and freshness, exact sponsor mapping, failed sources, pagination, individual role filtering, saved employers, missing and stale feeds, cached CSV loading and mobile layout. Browser tests use controlled fixtures and a separate local server; they do not depend on live employers.

## Scotland and Ireland filters

- **Scotland** includes identified Scottish cities and regions, plus postings explicitly offering UK-wide remote work. London-only or hybrid-London jobs are not treated as Scottish. Remote Scotland matches keep their actual location wording and a note to confirm working arrangements.
- **Ireland (Republic)** includes Irish locations such as Dublin, Cork, Galway and Limerick. **Northern Ireland** is a separate UK filter. Combining location chips uses OR; role focus and free-text location narrow that union.
- Location filters apply to each posting, not just the employer card. Counts, visible jobs and copied results use the same filtered set.
- Employers remain linked to their exact **UK register entity**. An Irish vacancy can be shown from that employer’s careers feed, but its Irish hiring entity and permit support are explicitly **unverified**. The UK route/rating filters describe the linked UK entity and do not establish Irish work permission. See [Ireland’s employment permit guidance](https://enterprise.gov.ie/en/what-we-do/workplace-and-skills/employment-permits/).

The ten Scotland/UK-remote and Ireland matches reviewed on 26 October 2026 have individual fit notes in `role-reviews.json`. These distinguish stronger content/communications overlaps from related marketing roles and identify requirements to check. They are assessments of the advertised work against Alex’s public portfolio, not guarantees of qualification or sponsorship. A SHA-256 fingerprint binds each review to its title, location, country and description. Refresh drops the note automatically if those details change; it never uses a review as evidence that a job is still open.
