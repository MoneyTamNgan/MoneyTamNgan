# Learn web development from MoneyTamNgan (for someone who "vibed" it)

Goal: understand this codebase well enough to explain it and change it, starting from zero.
Rule: **learn one layer at a time, and prove it by changing something small and watching the result.**
Install once: `npm ci`, put a MongoDB URI in `.env` (see `docs/local-deployment.md`), run `npm run dev`, open http://localhost:3000.

## The map: what happens when you open a page

```
Browser  --request-->  proxy.js (security checks, headers)  -->  Next.js
   page (app/**/page.*)  -->  shows HTML/React in the browser
   API  (app/api/**/route.js)  -->  reads/writes MongoDB through models/*  -->  JSON back
Worker (separate process)  -->  downloads TOR PDFs, OCR, AI summary  -->  MongoDB
```

Three words you must be able to say:
- **Frontend** = what runs in the browser (React components, `app/**/page`).
- **Backend / API** = code on the server that answers requests (`app/api/**/route.js`).
- **Database** = where data lives (MongoDB; shapes defined in `models/`).

## Level 0: JavaScript basics (2-3 days)
Learn: variables, functions, arrays/objects, `if`/loops, `async/await`, `import/export`, JSON.
Check yourself by reading `lib/auth-audit.js` (27 lines): you should be able to say what each line does.
Free resources: javascript.info (first 3 chapters), MDN "JavaScript basics".

## Level 1: How the web works (1 day)
Learn: HTTP request/response, URL, methods (GET/POST), status codes (200, 401, 404, 429), headers, cookies, JSON.
Exercise: with the app running, `curl -i http://localhost:3000/api/health` and read every line of the reply
(status, headers, JSON body). Then open `app/api/health/route.js` (23 lines): that file produced it.
This is also where security slides make sense: headers (slide 12), 401/404 (ownership), 429 (rate limit).

## Level 2: Backend and database (3-4 days)
Learn: what a route handler is, what a database document is, what Mongoose `schema` means.
- Read `app/api/health/route.js` -> `lib/db.js` (connect) -> `models/Keyword.js` (a small schema).
- Exercise: add a field to `models/Keyword.js`, restart, and see it appear in an API response.
- Then follow one real feature end to end: `app/api/tors/route.js` (list TORs with filters and pagination).

## Level 3: Frontend with React and Next.js (4-5 days)
Learn: components, props, state, `useEffect`, fetching from your own API; Next.js "app router"
(folder = URL: `app/analytics/page.js` is `/analytics`).
- Read `app/layout.js` (20 lines) then `app/page.tsx` (121 lines).
- Exercise: change a heading in `app/analytics/page.js`; refresh and see it. Then add one button that calls `/api/health`.
- Note: this project uses a very new Next.js. `AGENTS.md` says to read `node_modules/next/dist/docs/` rather than trusting old tutorials.

## Level 4: Tests (2 days)
Learn: what a unit test is. Run `npx vitest run tests/security/password-storage.test.js`, read it,
break the code on purpose and watch it fail. This is the safety net behind "800 tests".

## Level 5: Security (this is your course; 3-4 days)
Map each idea to one file and one test:
| Idea | File | Test |
|---|---|---|
| Hash passwords (scrypt + salt) | `lib/password-auth.js` | `tests/security/password-storage.test.js` |
| Signed session token (JWT) | `lib/auth.js` | `tests/security/auth.test.js` |
| Who may call what (roles/scopes) | `lib/request-authorization.js` | `tests/security/rbac-route-matrix.test.js` |
| Users can't see each other's data | `lib/bid-prep/security.js` | `tests/security/bid-prep-access.test.js` |
| Headers and CORS | `lib/security-policy.js`, `proxy.js` | `tests/security/scopes-cors-headers.test.js` |
| Rate limiting | `lib/rate-limit.js` | `tests/security/rate-limit.test.js` |
| Zip slip / file checks | `lib/archive-extractor.js` | `tests/security/zip-slip.test.js` |
Then read `docs/security/THREAT_MODEL.md` (STRIDE) and `docs/security/README.md` (SAST/DAST).

## Level 6: DevOps (1-2 days)
`Dockerfile`, `docker-compose.yml` (what runs where) and `.github/workflows/` (CI: tests, Semgrep, ZAP).

## The AI/pipeline part (last; optional)
`docs/tor-flow.md`, `docs/pipeline.md`: e-GP -> PDF -> OCR -> Vertex AI -> MongoDB. Read after the basics.

## Weekly rhythm
Read a file -> explain it out loud in your own words -> change one thing -> run the test -> write 3 lines of notes.
If you can't explain a file, ask an AI assistant "explain this line by line for a beginner", then close the
answer and explain it yourself. Understanding comes from the second step, not the first.
