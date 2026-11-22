# UI test sheet, `v1.0.0`, 22 Nov 2026

Plan: [test-plan.md](test-plan.md). Every flow is one recorded video; the time column is the position in that video. Results come from `results.json` written by the test run; nothing was edited by hand.

## Summary

| Flow | Title | Steps | Pass | Fail | Video | Length |
|---|---|---|---|---|---|---|
| F01-guest-browse | Guest browses TORs, searches, filters, pages, opens detail and analytics (no login) | 14 | 14 | 0 | [video](../evidence/testing-2026-11-22-full/F01-guest-browse/F01-guest-browse.webm) | 00:38 |
| F02-auth | Register, log out, log in by email and username, error cases, Google redirect | 11 | 11 | 0 | [video](../evidence/testing-2026-11-22-full/F02-auth/F02-auth.webm) | 00:21 |
| F03-access-control | Guests and normal users cannot reach protected pages and APIs; users cannot see each other's drafts | 8 | 8 | 0 | [video](../evidence/testing-2026-11-22-full/F03-access-control/F03-access-control.webm) | 00:15 |
| F04-profile | Edit the company profile, validation, persistence, delete company data, delete account | 13 | 13 | 0 | [video](../evidence/testing-2026-11-22-full/F04-profile/F04-profile.webm) | 00:26 |
| F05-tor-detail | Signed-in user reads a TOR: summary, qualification checklist (own status), prepare-draft link, dashboard | 9 | 9 | 0 | [video](../evidence/testing-2026-11-22-full/F05-tor-detail/F05-tor-detail.webm) | 00:21 |
| F06-bidprep-draft | BidPrep: create a draft, edit, sections, checklist gate, export DOCX, delete | 14 | 14 | 0 | [video](../evidence/testing-2026-11-22-full/F06-bidprep-draft/F06-bidprep-draft.webm) | 00:37 |
| F07-bidprep-ai | BidPrep: generate an AI draft (queued job, local model), TOR with a small scope | 5 | 5 | 0 | [video](../evidence/testing-2026-11-22-full/F07-bidprep-ai/F07-bidprep-ai.webm) | 01:51 |
| F07b-bidprep-ai-large-tor | BidPrep: generate an AI draft for a TOR with a large scope (47 items) | 5 | 5 | 0 | [video](../evidence/testing-2026-11-22-full/F07b-bidprep-ai-large-tor/F07b-bidprep-ai-large-tor.webm) | 01:35 |
| F08-admin | Admin console: ingestion status, health, review queue (read only, nothing is triggered) | 7 | 7 | 0 | [video](../evidence/testing-2026-11-22-full/F08-admin/F08-admin.webm) | 00:17 |

**Total: 86 passed, 0 failed of 86 steps.**

## F01-guest-browse: Guest browses TORs, searches, filters, pages, opens detail and analytics (no login)

Video: [F01-guest-browse/F01-guest-browse.webm](../evidence/testing-2026-11-22-full/F01-guest-browse/F01-guest-browse.webm)

| Step | Action | Expected | Actual | Result | Video time | Screenshot |
|---|---|---|---|---|---|---|
| 01 | Open the dashboard as a guest | Heading "ค้นหาโครงการจากหน่วยงานภาครัฐ" and at least one TOR card are visible | as expected | ✅ PASS | 00:00 | [img](../evidence/testing-2026-11-22-full/F01-guest-browse/01-01.png) |
| 02 | Click the second hero slide indicator | The slide indicator state changes (markup of the indicators differs before and after) | indicator state changed | ✅ PASS | 00:02 | [img](../evidence/testing-2026-11-22-full/F01-guest-browse/02-02.png) |
| 03 | Type a keyword in the search box | After the 300 ms debounce the list is requested with q= (HTTP 200) and the URL carries q= | /tors?isSoftware=true&q=ระบบ&page=1&limit=10 -> 200 | ✅ PASS | 00:04 | [img](../evidence/testing-2026-11-22-full/F01-guest-browse/03-03.png) |
| 04 | Go to the next page of results | The URL shows page=2 and the first card is a different project than on page 1 | /?next=%2Ftors%2F69109345522 -> /?next=%2Ftors%2F69109271962 | ✅ PASS | 00:06 | [img](../evidence/testing-2026-11-22-full/F01-guest-browse/04-04.png) |
| 05 | Use the filters: software toggle, agency, bidding status, minimum budget, sort | Software, agency, status and budget each change the URL; sorting by highest budget re-orders the list (sorting is applied on the page, not in the URL) | software=0, agency, status, budgetMin, sort re-ordered | ✅ PASS | 00:07 | [img](../evidence/testing-2026-11-22-full/F01-guest-browse/05-05.png) |
| 06 | Click the first TOR card as a guest | Clicking a card as a guest goes to the sign-in page with ?next=/tors/<id> | url ?next=%2Ftors%2F69109345522 | ✅ PASS | 00:12 | [img](../evidence/testing-2026-11-22-full/F01-guest-browse/06-06.png) |
| 07 | Open a TOR detail page directly as a guest | URL is /tors/<id>; the TOR overview is shown with the notice "เข้าสู่ระบบเพื่อดูรายละเอียดโครงการฉบับเต็ม"; the comparison card with the company profile ("มูลค่าผลงานขั้นต่ำตาม TOR") is not shown to a guest | as expected | ✅ PASS | 00:15 | [img](../evidence/testing-2026-11-22-full/F01-guest-browse/07-07.png) |
| 08 | Open the document page of the TOR | The page shows the same project title as the detail page | as expected | ✅ PASS | 00:16 | [img](../evidence/testing-2026-11-22-full/F01-guest-browse/08-08.png) |
| 09 | Open Analytics and change a filter | The analytics API is called again with HTTP 200 and the page stays populated | as expected | ✅ PASS | 00:18 | [img](../evidence/testing-2026-11-22-full/F01-guest-browse/09-09.png) |
| 10 | Clear the filters | The filter returns to its first option and the data reloads | as expected | ✅ PASS | 00:20 | [img](../evidence/testing-2026-11-22-full/F01-guest-browse/10-10.png) |
| 11 | Switch the chart mode to "ความพร้อมเอกสาร" and back | The chart heading changes to "ความพร้อมของเอกสาร TOR" and returns to "TOR ตามปีงบประมาณ" | as expected | ✅ PASS | 00:21 | [img](../evidence/testing-2026-11-22-full/F01-guest-browse/11-11.png) |
| 12 | Export the analytics as CSV and as JSON | Two downloads start: a .csv and a .json file | tor-analytics-2026-11-22.csv, tor-analytics-2026-11-22.json | ✅ PASS | 00:22 | [img](../evidence/testing-2026-11-22-full/F01-guest-browse/12-12.png) |
| 13 | Toggle the theme and collapse the sidebar | The theme control changes the page theme and the sidebar toggle flips aria-expanded | as expected | ✅ PASS | 00:24 | [img](../evidence/testing-2026-11-22-full/F01-guest-browse/13-13.png) |
| 14 | Open the public pages on a phone-sized screen (360 px) and a tablet (768 px) | No page is wider than the screen (no sideways scrolling) on /, /projects, /analytics and /dashboard | 360:/=360 360:/projects=360 360:/analytics=360 360:/dashboard=360 768:/=768 768:/projects=768 768:/analytics=768 768:/dashboard=768 | ✅ PASS | 00:26 | [img](../evidence/testing-2026-11-22-full/F01-guest-browse/14-14.png) |

## F02-auth: Register, log out, log in by email and username, error cases, Google redirect

Video: [F02-auth/F02-auth.webm](../evidence/testing-2026-11-22-full/F02-auth/F02-auth.webm)

| Step | Action | Expected | Actual | Result | Video time | Screenshot |
|---|---|---|---|---|---|---|
| 01 | Open the sign-in page | The login form (identifier and password) is shown | as expected | ✅ PASS | 00:00 | [img](../evidence/testing-2026-11-22-full/F02-auth/01-01.png) |
| 02 | Switch to "สร้างบัญชี" and submit with mismatching passwords | The alert says the two passwords do not match ("ไม่ตรงกัน") | รหัสผ่านทั้งสองช่องไม่ตรงกัน | ✅ PASS | 00:01 | [img](../evidence/testing-2026-11-22-full/F02-auth/02-02.png) |
| 03 | Submit with a password shorter than 15 characters | The browser blocks the submit (password field reports "too short") and no account is created | validity.tooShort = true | ✅ PASS | 00:02 | [img](../evidence/testing-2026-11-22-full/F02-auth/03-03.png) |
| 04 | Register with a valid email, username and password | The account is created and the user lands inside the app; the session belongs to the new email | landed on /dashboard | ✅ PASS | 00:04 | [img](../evidence/testing-2026-11-22-full/F02-auth/04-04.png) |
| 05 | Log out | Returns to the sign-in page and the session is gone (/api/auth/me = 401) | as expected | ✅ PASS | 00:06 | [img](../evidence/testing-2026-11-22-full/F02-auth/05-05.png) |
| 06 | Log in with a wrong password | The same generic error is shown for a wrong password on a real account and for an account that does not exist (no account enumeration) | same message for known and unknown account: อีเมล/ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง หรือโปรดใช้ Google หากสมัครด้วย Google | ✅ PASS | 00:07 | [img](../evidence/testing-2026-11-22-full/F02-auth/06-06.png) |
| 07 | Log in with the email | Signed in as the new account | as expected | ✅ PASS | 00:09 | [img](../evidence/testing-2026-11-22-full/F02-auth/07-07.png) |
| 08 | Log out, then log in with the username in upper case | Signed in as the same account (username is case-insensitive) | as expected | ✅ PASS | 00:12 | [img](../evidence/testing-2026-11-22-full/F02-auth/08-08.png) |
| 09 | Register again with the same email | An alert says the email already has an account ("มีบัญชีอยู่แล้ว") | อีเมลนี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบด้วยวิธีเดิม | ✅ PASS | 00:15 | [img](../evidence/testing-2026-11-22-full/F02-auth/09-09.png) |
| 10 | Click "เข้าสู่ระบบด้วย Google" | The browser is sent to accounts.google.com (we stop there; no real Google sign-in) | redirected to accounts.google.com | ✅ PASS | 00:18 | [img](../evidence/testing-2026-11-22-full/F02-auth/10-10.png) |
| 11 | Cleanup: sign in and delete the test account (API) | HTTP 200 | as expected | ✅ PASS | 00:20 | [img](../evidence/testing-2026-11-22-full/F02-auth/11-11.png) |

## F03-access-control: Guests and normal users cannot reach protected pages and APIs; users cannot see each other's drafts

Video: [F03-access-control/F03-access-control.webm](../evidence/testing-2026-11-22-full/F03-access-control/F03-access-control.webm)

| Step | Action | Expected | Actual | Result | Video time | Screenshot |
|---|---|---|---|---|---|---|
| 01 | Guest opens /profile | Redirected to the sign-in page | as expected | ✅ PASS | 00:00 | [img](../evidence/testing-2026-11-22-full/F03-access-control/01-01.png) |
| 02 | Guest opens /admin | Redirected to the sign-in page | as expected | ✅ PASS | 00:01 | [img](../evidence/testing-2026-11-22-full/F03-access-control/02-02.png) |
| 03 | Guest calls the drafts API and the admin API | 401 for both | drafts 401, admin 401 | ✅ PASS | 00:02 | [img](../evidence/testing-2026-11-22-full/F03-access-control/03-03.png) |
| 04 | Sign in as a normal user and open /admin | The page says admin permission is required and shows no admin console | as expected | ✅ PASS | 00:03 | [img](../evidence/testing-2026-11-22-full/F03-access-control/04-04.png) |
| 05 | Normal user calls the admin API | 403 | as expected | ✅ PASS | 00:05 | [img](../evidence/testing-2026-11-22-full/F03-access-control/05-05.png) |
| 06 | User A creates a draft (API); user B opens its URL in the browser and via the API | B sees none of A's content in the page; the API answers 404 and B's list is empty | UI shows no content; API 404; B has 0 drafts | ✅ PASS | 00:06 | [img](../evidence/testing-2026-11-22-full/F03-access-control/06-06.png) |
| 07 | Check the security headers of a normal page response | Content-Security-Policy, X-Content-Type-Options and a frame-ancestors/X-Frame-Options rule are sent (this run disables CSP in the test browser, so the header is checked here) | CSP + nosniff present | ✅ PASS | 00:12 | [img](../evidence/testing-2026-11-22-full/F03-access-control/07-07.png) |
| 08 | Cleanup: delete both test accounts | Both deletions return HTTP 200 | as expected | ✅ PASS | 00:13 | [img](../evidence/testing-2026-11-22-full/F03-access-control/08-08.png) |

## F04-profile: Edit the company profile, validation, persistence, delete company data, delete account

Video: [F04-profile/F04-profile.webm](../evidence/testing-2026-11-22-full/F04-profile/F04-profile.webm)

| Step | Action | Expected | Actual | Result | Video time | Screenshot |
|---|---|---|---|---|---|---|
| 01 | Sign in and open the profile page | Heading "ตั้งค่าโปรไฟล์และทักษะบริษัท" is shown with an empty company name | as expected | ✅ PASS | 00:00 | [img](../evidence/testing-2026-11-22-full/F04-profile/01-01.png) |
| 02 | Fill company name, capital, highest past-project value and capacity | The fields hold exactly what was typed | as expected | ✅ PASS | 00:02 | [img](../evidence/testing-2026-11-22-full/F04-profile/02-02.png) |
| 03 | Fill registration number, signatory and address | The fields hold exactly what was typed | as expected | ✅ PASS | 00:03 | [img](../evidence/testing-2026-11-22-full/F04-profile/03-03.png) |
| 04 | Add a past project and fill it in | The counter shows "ผลงานที่ผ่านมา (1/50)" and the four fields keep their values | as expected | ✅ PASS | 00:04 | [img](../evidence/testing-2026-11-22-full/F04-profile/04-04.png) |
| 05 | Pick three skills and one certification | The skills counter shows "3 รายการ" and a picked chip looks different from an unpicked one | as expected | ✅ PASS | 00:05 | [img](../evidence/testing-2026-11-22-full/F04-profile/05-05.png) |
| 06 | Turn email notifications on and set threshold and frequency | The switch is on and the frequency select holds a non-default option | as expected | ✅ PASS | 00:06 | [img](../evidence/testing-2026-11-22-full/F04-profile/06-06.png) |
| 07 | Click "บันทึกข้อมูลโปรไฟล์" | The save request (PATCH) succeeds with HTTP 200 | PATCH -> 200 | ✅ PASS | 00:07 | [img](../evidence/testing-2026-11-22-full/F04-profile/07-07.png) |
| 08 | Reload the page | Company name, address, skills, certification, notification switch and the past project are all still there (screen and API) | as expected | ✅ PASS | 00:08 | [img](../evidence/testing-2026-11-22-full/F04-profile/08-08.png) |
| 09 | Enter a negative capital and save | The form shows a field error, no save request is sent and the stored value is unchanged | Must be a number between 0 and 1000000000000000. | ✅ PASS | 00:10 | [img](../evidence/testing-2026-11-22-full/F04-profile/09-09.png) |
| 10 | Remove the past project | The counter returns to "ผลงานที่ผ่านมา (0/50)"; after saving, the API stores no past project | as expected | ✅ PASS | 00:12 | [img](../evidence/testing-2026-11-22-full/F04-profile/10-10.png) |
| 11 | Create a draft (API), then click "ลบข้อมูลบริษัท" and confirm | Company data and drafts are cleared (checked in the API); the account stays | as expected | ✅ PASS | 00:15 | [img](../evidence/testing-2026-11-22-full/F04-profile/11-11.png) |
| 12 | Click "ลบบัญชีผู้ใช้" and confirm | The user is sent to the sign-in page and the session is gone | as expected | ✅ PASS | 00:22 | [img](../evidence/testing-2026-11-22-full/F04-profile/12-12.png) |
| 13 | Try to sign in with the deleted account | Sign-in is refused with the generic error | อีเมล/ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง หรือโปรดใช้ Google หากสมัครด้วย Google | ✅ PASS | 00:24 | [img](../evidence/testing-2026-11-22-full/F04-profile/13-13.png) |

## F05-tor-detail: Signed-in user reads a TOR: summary, qualification checklist (own status), prepare-draft link, dashboard

Video: [F05-tor-detail/F05-tor-detail.webm](../evidence/testing-2026-11-22-full/F05-tor-detail/F05-tor-detail.webm)

| Step | Action | Expected | Actual | Result | Video time | Screenshot |
|---|---|---|---|---|---|---|
| 01 | Sign in and open a TOR detail page | No guest notice is shown, and the signed-in-only comparison cards (qualification value and checklist) are present | as expected | ✅ PASS | 00:00 | [img](../evidence/testing-2026-11-22-full/F05-tor-detail/01-01.png) |
| 03 | Scroll to the qualification checklist card | Items with the status buttons per item are visible | as expected | ✅ PASS | 00:03 | [img](../evidence/testing-2026-11-22-full/F05-tor-detail/02-03.png) |
| 04 | Mark the first item "ผ่าน" | The button is pressed (aria-pressed) and the API reports status pass for that item | as expected | ✅ PASS | 00:04 | [img](../evidence/testing-2026-11-22-full/F05-tor-detail/03-04.png) |
| 05 | Change the first item to "ไม่ผ่าน", then press it again | The API reports fail; pressing the same button again returns the item to the system value (manual) | as expected | ✅ PASS | 00:07 | [img](../evidence/testing-2026-11-22-full/F05-tor-detail/04-05.png) |
| 06 | Page through the checklist ("ถัดไป →") | A different first item is shown on the next page | as expected | ✅ PASS | 00:10 | [img](../evidence/testing-2026-11-22-full/F05-tor-detail/05-06.png) |
| 07 | Click "เตรียมร่างข้อเสนอ" | The BidPrep page opens with projectId in the URL | as expected | ✅ PASS | 00:12 | [img](../evidence/testing-2026-11-22-full/F05-tor-detail/06-07.png) |
| 08 | Open the document page of the TOR | The document view shows a project heading | as expected | ✅ PASS | 00:13 | [img](../evidence/testing-2026-11-22-full/F05-tor-detail/07-08.png) |
| 09 | Open the dashboard | Cards link to /tors/<id> (not to sign-in), unlike the guest view | first card -> /tors/69109345522 | ✅ PASS | 00:15 | [img](../evidence/testing-2026-11-22-full/F05-tor-detail/08-09.png) |
| 10 | Cleanup: delete the test account | HTTP 200 | as expected | ✅ PASS | 00:20 | [img](../evidence/testing-2026-11-22-full/F05-tor-detail/09-10.png) |

## F06-bidprep-draft: BidPrep: create a draft, edit, sections, checklist gate, export DOCX, delete

Video: [F06-bidprep-draft/F06-bidprep-draft.webm](../evidence/testing-2026-11-22-full/F06-bidprep-draft/F06-bidprep-draft.webm)

| Step | Action | Expected | Actual | Result | Video time | Screenshot |
|---|---|---|---|---|---|---|
| 01 | Sign in, fill a minimal profile (API) and open "เตรียมข้อเสนอ" | Heading "ร่างข้อเสนอของฉัน" and the empty-list message are shown | as expected | ✅ PASS | 00:00 | [img](../evidence/testing-2026-11-22-full/F06-bidprep-draft/01-01.png) |
| 02 | Create a draft with an unknown TOR id | The message "TOR not found" is shown and no draft page opens | as expected | ✅ PASS | 00:03 | [img](../evidence/testing-2026-11-22-full/F06-bidprep-draft/02-02.png) |
| 03 | Create a draft for a real TOR | The draft editor opens for that TOR at version 1 | as expected | ✅ PASS | 00:05 | [img](../evidence/testing-2026-11-22-full/F06-bidprep-draft/03-03.png) |
| 04 | Edit the title and the first section, then save | The save returns HTTP 200 and the version shown becomes 2 | save -> 200, version 2 | ✅ PASS | 00:07 | [img](../evidence/testing-2026-11-22-full/F06-bidprep-draft/04-04.png) |
| 05 | Add a section | The number of sections goes up by one | 2 -> 3 sections | ✅ PASS | 00:09 | [img](../evidence/testing-2026-11-22-full/F06-bidprep-draft/05-05.png) |
| 06 | Delete the added section | The number of sections goes back down by one | back to 2 sections | ✅ PASS | 00:10 | [img](../evidence/testing-2026-11-22-full/F06-bidprep-draft/06-06.png) |
| 07 | Save, then look at the export button before the checklist passes | With nothing unsaved, the DOCX button is still disabled and the page asks for every item to be "ผ่าน" | as expected | ✅ PASS | 00:11 | [img](../evidence/testing-2026-11-22-full/F06-bidprep-draft/07-07.png) |
| 08 | Open the checklist tab | The summary cards (ผ่าน / ไม่ผ่าน / ตรวจสอบเอง) are shown and the three numbers add up to the 11 items | 11 items | ✅ PASS | 00:12 | [img](../evidence/testing-2026-11-22-full/F06-bidprep-draft/08-08.png) |
| 09 | Mark one item "ไม่ผ่าน" | The "ไม่ผ่าน" counter becomes 1 | as expected | ✅ PASS | 00:13 | [img](../evidence/testing-2026-11-22-full/F06-bidprep-draft/09-09.png) |
| 10 | Mark every item "ผ่าน" on all pages | The "ผ่าน" counter equals 11 and the other two are 0 | 11 clicks on 3 page(s), counters 11/0/0 | ✅ PASS | 00:15 | [img](../evidence/testing-2026-11-22-full/F06-bidprep-draft/10-10.png) |
| 11 | Download the DOCX (saving first if the page reports unsaved changes) | A .docx download starts and the file is a valid zip (first bytes "PK") | download bid-draft-69109232352.docx (21795 bytes) | ✅ PASS | 00:29 | [img](../evidence/testing-2026-11-22-full/F06-bidprep-draft/11-11.png) |
| 12 | Return to the list and open the saved draft | The draft is listed with its title and opens at version 3 or higher, showing the saved title and first section heading | as expected | ✅ PASS | 00:31 | [img](../evidence/testing-2026-11-22-full/F06-bidprep-draft/12-12.png) |
| 13 | Delete the draft | The list shows the empty message and the API has 0 drafts | as expected | ✅ PASS | 00:34 | [img](../evidence/testing-2026-11-22-full/F06-bidprep-draft/13-13.png) |
| 14 | Cleanup: delete the test account | HTTP 200 | as expected | ✅ PASS | 00:36 | [img](../evidence/testing-2026-11-22-full/F06-bidprep-draft/14-14.png) |

## F07-bidprep-ai: BidPrep: generate an AI draft (queued job, local model), TOR with a small scope

Video: [F07-bidprep-ai/F07-bidprep-ai.webm](../evidence/testing-2026-11-22-full/F07-bidprep-ai/F07-bidprep-ai.webm)

| Step | Action | Expected | Actual | Result | Video time | Screenshot |
|---|---|---|---|---|---|---|
| 01 | Sign in, fill a profile and open "เตรียมข้อเสนอ" | The page loads with the AI warning | as expected | ✅ PASS | 00:00 | [img](../evidence/testing-2026-11-22-full/F07-bidprep-ai/01-01.png) |
| 02 | Enter a TOR id and click "สร้างร่างด้วย AI" | A job is queued (HTTP 202) and the page shows "กำลังรอผล AI" with a job number | queued -> 202 | ✅ PASS | 00:02 | [img](../evidence/testing-2026-11-22-full/F07-bidprep-ai/02-02.png) |
| 03 | Wait for the job to finish (up to 5.5 minutes) | When the job completes the page opens the saved draft (or lists it under "ร่างที่บันทึกไว้"); if the job fails, the page must show why | ready after 96 s | ✅ PASS | 00:04 | [img](../evidence/testing-2026-11-22-full/F07-bidprep-ai/03-03.png) |
| 04 | Open the AI draft | The editor shows at least 3 sections, source lists and at least one "[to fill in: ...]" placeholder | as expected | ✅ PASS | 01:41 | [img](../evidence/testing-2026-11-22-full/F07-bidprep-ai/04-04.png) |
| 05 | Cleanup: delete the test account and its drafts | HTTP 200 | as expected | ✅ PASS | 01:42 | [img](../evidence/testing-2026-11-22-full/F07-bidprep-ai/05-05.png) |

## F07b-bidprep-ai-large-tor: BidPrep: generate an AI draft for a TOR with a large scope (47 items)

Video: [F07b-bidprep-ai-large-tor/F07b-bidprep-ai-large-tor.webm](../evidence/testing-2026-11-22-full/F07b-bidprep-ai-large-tor/F07b-bidprep-ai-large-tor.webm)

| Step | Action | Expected | Actual | Result | Video time | Screenshot |
|---|---|---|---|---|---|---|
| 01 | Sign in, fill a profile and open "เตรียมข้อเสนอ" | The page loads with the AI warning | as expected | ✅ PASS | 00:00 | [img](../evidence/testing-2026-11-22-full/F07b-bidprep-ai-large-tor/01-01.png) |
| 02 | Enter a TOR id and click "สร้างร่างด้วย AI" | A job is queued (HTTP 202) and the page shows "กำลังรอผล AI" with a job number | queued -> 202 | ✅ PASS | 00:02 | [img](../evidence/testing-2026-11-22-full/F07b-bidprep-ai-large-tor/02-02.png) |
| 03 | Wait for the job to finish (up to 5.5 minutes) | When the job completes the page opens the saved draft (or lists it under "ร่างที่บันทึกไว้"); if the job fails, the page must show why | ready after 81 s | ✅ PASS | 00:04 | [img](../evidence/testing-2026-11-22-full/F07b-bidprep-ai-large-tor/03-03.png) |
| 04 | Open the AI draft | The editor shows at least 3 sections, source lists and at least one "[to fill in: ...]" placeholder | as expected | ✅ PASS | 01:26 | [img](../evidence/testing-2026-11-22-full/F07b-bidprep-ai-large-tor/04-04.png) |
| 05 | Cleanup: delete the test account and its drafts | HTTP 200 | as expected | ✅ PASS | 01:27 | [img](../evidence/testing-2026-11-22-full/F07b-bidprep-ai-large-tor/05-05.png) |

## F08-admin: Admin console: ingestion status, health, review queue (read only, nothing is triggered)

Video: [F08-admin/F08-admin.webm](../evidence/testing-2026-11-22-full/F08-admin/F08-admin.webm)

| Step | Action | Expected | Actual | Result | Video time | Screenshot |
|---|---|---|---|---|---|---|
| 01 | Sign in as an admin | Signed in; the session role is admin | as expected | ✅ PASS | 00:00 | [img](../evidence/testing-2026-11-22-full/F08-admin/01-01.png) |
| 02 | Open /admin | The console shows the ingestion status and the scraper health section | as expected | ✅ PASS | 00:02 | [img](../evidence/testing-2026-11-22-full/F08-admin/02-02.png) |
| 03 | Read the review queue | The queue finishes loading and shows rows or an empty-state message (not the loading text) | 5 row(s) in the queue | ✅ PASS | 00:03 | [img](../evidence/testing-2026-11-22-full/F08-admin/03-03.png) |
| 04 | Filter the queue by reason | The reason filter is applied to the rows on the page: the row count does not grow | 5 -> 3 rows | ✅ PASS | 00:10 | [img](../evidence/testing-2026-11-22-full/F08-admin/04-04.png) |
| 05 | Search the queue for text that matches nothing | The queue shows no rows (or only the empty-state row) | as expected | ✅ PASS | 00:13 | [img](../evidence/testing-2026-11-22-full/F08-admin/05-05.png) |
| 06 | Admin API status call | HTTP 200 with a pipeline status body | status -> 200 | ✅ PASS | 00:15 | [img](../evidence/testing-2026-11-22-full/F08-admin/06-06.png) |
| 07 | Cleanup: delete the admin test account | HTTP 200 | as expected | ✅ PASS | 00:16 | [img](../evidence/testing-2026-11-22-full/F08-admin/07-07.png) |

## Defects found

None in this run.
