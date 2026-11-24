# Company details for bids — #136

Traces to: FR-2.2.1, FR-2.2.2, FR-2.2.3 and BidPrep FR-4.1 ([#136](https://github.com/MoneyTamNgan/MoneyTamNgan/issues/136)). See [traceability.md](traceability.md).

The authenticated company profile now stores the registration number, address, authorized signatory and up to 50 past projects directly on the existing `users` document. These facts are already consumed by the bid-draft profile allowlist. No new collection or forced migration is required. Old users receive empty strings and an empty history until they save bid details.

## Field rules

| Field | Rule |
| --- | --- |
| `registration_number` | Optional trimmed string, up to 100 characters; no country-specific format assumption |
| `address` | Optional trimmed string, up to 2,000 characters; supports multiple lines |
| `authorized_signatory` | Optional trimmed string, up to 200 characters |
| `past_projects` | Array of at most 50 objects; replace the array to edit/remove rows; `[]` clears it |
| Project `name`, `client` | Required nonempty trimmed strings, up to 200 characters each |
| Project `value` | Required finite number from 0 through 10^15 THB; numeric strings are rejected |
| Project `year` | Required whole Buddhist Era year, 2400–2700, preserved without conversion; aligns with existing bid-draft shaping |

Existing profile fields are validated too: name/company name at most 200 characters; each skills/techStack/certifications array at most 100 trimmed text entries of at most 100 characters; monetary values null or finite nonnegative numbers up to 10^15; concurrent capacity null or an integer from 0 through 10,000; threshold a number from 0 through 100; notification preference a boolean and frequency IMMEDIATE/DAILY_DIGEST. Unknown fields are ignored at the top level and inside project objects. Sending numeric strings, booleans as numbers, or objects as strings returns a field error instead of coercion.

## API and ownership

`GET /api/profiles` reads only the current session owner. `PUT` and `PATCH` both perform partial allowlisted updates for that same owner. User IDs from query parameters or request bodies never select another account; `role`, `scopes`, `googleId` and `passwordHash` cannot be updated through this route. Responses explicitly map public profile fields and never include Google identifiers or password hashes. Both methods require `application/json`, a body at most 128 KiB and the existing scoped authentication/rate limits. Cookie writes also require an approved Origin.

Example PUT body:

```json
{
  "registration_number": "0105555555555",
  "address": "99 ถนนตัวอย่าง กรุงเทพฯ",
  "authorized_signatory": "ผู้ลงนามตัวอย่าง",
  "past_projects": [
    { "name": "ระบบบริการออนไลน์", "client": "หน่วยงานตัวอย่าง", "value": 2500000, "year": 2569 }
  ]
}
```

Success keeps the existing `{ "status": "success", "data": { ...profile } }` response envelope. [Sanitized real HTTP examples](evidence/company-profile/http.json) contain fixture data only. Invalid values return 400, for example:

```json
{
  "error": {
    "code": "INVALID_PROFILE",
    "message": "Please correct the highlighted profile fields.",
    "fields": { "past_projects.0.value": "Must be a number between 0 and 1000000000000000." }
  }
}
```

Malformed JSON returns 400, unsupported content type 415, oversize body 413, unauthenticated requests 401, missing scope/invalid Origin 403 and rate-limited requests 429. Storage failures return 500 without exposing provider details.

## Form, storage and deletion

`/profile` adds labeled company fields and repeatable past-project rows. Each row can be edited or removed; adding stops at 50. Client and server share validation rules, and field errors appear beside the relevant control. Failed/unauthenticated/offline saves remain unsaved and do not appear as successful local saves. The existing save and reload flow reads its authoritative values from MongoDB.

Bid identity fields and project history are excluded from the existing browser cache; they are loaded from the authenticated API. The legacy cache remains for existing non-bid fields. New bid details therefore do not persist offline. The existing confirmed company deletion action clears every company/bid field and drafts, while preserving the account and notification settings. Individual project removal saves the edited array. Removing an account retains the existing account-and-draft deletion behavior.

## Evidence and testing

- All 280 Node tests and the full 331-test Vitest suite passed; the added OpenAPI contract check then passed with the 50-test focused profile/contract run.
- Production build passed. Redocly lint passed with 9 existing nonblocking warnings. The initial npx registry lookup was blocked by DNS; the installed cached Redocly CLI validated the same specification successfully.
- `node scripts/test-company-profile-http.js /tmp/profile-evidence` passed against a real running Next server and an isolated Atlas database. It verified HTTP auth, ownership, protected-field injection, trim/persistence, invalid-value errors, actual form add/remove/save/reload and the existing company deletion action. It removed only its own random test database and stopped its own server/browser. It does not touch production users, scraping, Vertex or email.
- The mobile test checks both horizontal overflow and separation from the fixed navigation rail. The profile-only mobile layout correction prevents that rail from covering inputs.
- [Desktop screenshot](evidence/company-profile/desktop.png) and [mobile screenshot](evidence/company-profile/mobile.png) were visually inspected and show fictitious company data.

Reproduce:

```sh
npm run build
node scripts/test-company-profile-http.js /tmp/profile-evidence
npx vitest run tests/integration/company-profile.integration.test.js tests/integration/company-profile-client.integration.test.ts tests/integration/company-profile-model.integration.test.js tests/integration/profiles-route.integration.test.js tests/integration/scoped-profile-route.integration.test.js tests/contract/openapi-contract.test.ts
npx @redocly/cli lint docs/api/openapi.yaml
```

For a manual demo, sign in and open `/profile`. Fill the three identity fields, add a project with a nonnegative value and BE year, save and reload. Edit/remove a row and repeat. Enter a negative value to see an error, then use the existing confirmed company deletion flow only on disposable data. A teammate's non-author approval and merge into develop remain separate acceptance requirements.
