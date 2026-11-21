# BidPrep demo script (about 4 minutes)

Use the demo account and a made-up company profile. **Never use real company data.** Demo from a browser on the machine at `http://localhost:3000` (session cookie is `Secure`).

| Min | Speaker | Step | Data |
|---|---|---|---|
| 0:00 | A | Say what it does and that it does not submit to e-GP | none |
| 0:30 | A | Log in, open the company profile, show the filled details | demo profile |
| 1:15 | B | Open TOR 66089621504, show the checklist (met / not met / unknown with reasons and page) | sample TOR |
| 2:00 | B | Generate a draft; while it runs, show another saved draft | pre-made draft |
| 3:00 | A | Edit one paragraph, export DOCX, open the file | |
| 3:45 | A | Log in as second account: it cannot see the first account's draft (404) | 2nd demo account |

## Fallback
Decide on the day before (18 Nov rule): if the AI draft is not stable (2 of 3 real TORs timed out at 90 s on this hardware), demo only the checklist, show the pre-made draft and DOCX, and tell the customer beforehand.

## Do not
- Do not run `scheduler` or any ingestion during the demo.
- Do not show `.env`, terminals with secrets, or the Atlas console.
- Do not generate a draft live without the fallback ready.
