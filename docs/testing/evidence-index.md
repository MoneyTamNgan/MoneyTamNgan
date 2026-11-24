# Evidence index: every function, with its video and screenshot

The FR column maps each step to an SRS id. Main SRS ids stay `FR-*` and `NFR-*`. Bid Preparation ids use the `BidPrep FR-4.x` prefix. Convention: [traceability.md](../traceability.md#requirement-id-convention).

Run of 22 Nov 2026 on the demo machine, `v1.0.0` plus the fixes of PR #242, #243 and #245, real Atlas. 86 of 86 steps pass ([test-sheet.md](test-sheet.md)). One video per flow; each row gives the time in the video and the screenshot of that step. The AI draft flows (F07, F07b) used the `agy` CLI as the AI not the local model: the machine was set to `AI_PROVIDER=vertex` with `AI_FALLBACK_PROVIDER=agy`, Vertex refused (no credentials) and the request fell back to [the bridge](../agy-bridge.md) running on the demo machine itself. Evidence from before the fixes (81 of 85) is kept in [../evidence/testing-2026-11-22/](../evidence/testing-2026-11-22/).

## F01-guest-browse: Guest browses TORs, searches, filters, pages, opens detail and analytics (no login)

Video: [F01-guest-browse/F01-guest-browse.webm](../evidence/testing-2026-11-22-full/F01-guest-browse/F01-guest-browse.webm)

| Step | FR | Function tested | Result | Video time | Screenshot |
| --- | --- | --- | --- | --- | --- |
| 01 | FR-4.2.1; NFR-1; NFR-6 | Open the dashboard as a guest | PASS | 00:00 | [img](../evidence/testing-2026-11-22-full/F01-guest-browse/01-01.png) |
| 02 | NFR-1 | Click the second hero slide indicator | PASS | 00:02 | [img](../evidence/testing-2026-11-22-full/F01-guest-browse/02-02.png) |
| 03 | FR-4.1.2 | Type a keyword in the search box | PASS | 00:04 | [img](../evidence/testing-2026-11-22-full/F01-guest-browse/03-03.png) |
| 04 | FR-4.1.2 | Go to the next page of results | PASS | 00:06 | [img](../evidence/testing-2026-11-22-full/F01-guest-browse/04-04.png) |
| 05 | FR-4.1.2; FR-1.2.2 | Use the filters: software toggle, agency, bidding status, minimum budget, sort | PASS | 00:07 | [img](../evidence/testing-2026-11-22-full/F01-guest-browse/05-05.png) |
| 06 | FR-4.2.1 | Click the first TOR card as a guest | PASS | 00:12 | [img](../evidence/testing-2026-11-22-full/F01-guest-browse/06-06.png) |
| 07 | FR-4.2.1 | Open a TOR detail page directly as a guest | PASS | 00:15 | [img](../evidence/testing-2026-11-22-full/F01-guest-browse/07-07.png) |
| 08 | FR-4.2.1 | Open the document page of the TOR | PASS | 00:16 | [img](../evidence/testing-2026-11-22-full/F01-guest-browse/08-08.png) |
| 09 | FR-4.1.3; FR-4.2.1 | Open Analytics and change a filter | PASS | 00:18 | [img](../evidence/testing-2026-11-22-full/F01-guest-browse/09-09.png) |
| 10 | FR-4.1.3 | Clear the filters | PASS | 00:19 | [img](../evidence/testing-2026-11-22-full/F01-guest-browse/10-10.png) |
| 11 | FR-4.1.3 | Switch the chart mode to "ความพร้อมเอกสาร" and back | PASS | 00:21 | [img](../evidence/testing-2026-11-22-full/F01-guest-browse/11-11.png) |
| 12 | FR-4.1.3 | Export the analytics as CSV and as JSON | PASS | 00:21 | [img](../evidence/testing-2026-11-22-full/F01-guest-browse/12-12.png) |
| 13 | NFR-1 | Toggle the theme and collapse the sidebar | PASS | 00:24 | [img](../evidence/testing-2026-11-22-full/F01-guest-browse/13-13.png) |
| 14 | FR-4.2.1; NFR-6 | Open the public pages on a phone-sized screen (360 px) and a tablet (768 px) | PASS | 00:26 | [img](../evidence/testing-2026-11-22-full/F01-guest-browse/14-14.png) |

## F02-auth: Register, log out, log in by email and username, error cases, Google redirect

Video: [F02-auth/F02-auth.webm](../evidence/testing-2026-11-22-full/F02-auth/F02-auth.webm)

| Step | FR | Function tested | Result | Video time | Screenshot |
| --- | --- | --- | --- | --- | --- |
| 01 | FR-2.2.1 | Open the sign-in page | PASS | 00:00 | [img](../evidence/testing-2026-11-22-full/F02-auth/01-01.png) |
| 02 | FR-2.2.1 | Switch to "สร้างบัญชี" and submit with mismatching passwords | PASS | 00:01 | [img](../evidence/testing-2026-11-22-full/F02-auth/02-02.png) |
| 03 | FR-2.2.1 | Submit with a password shorter than 15 characters | PASS | 00:02 | [img](../evidence/testing-2026-11-22-full/F02-auth/03-03.png) |
| 04 | FR-2.2.1 | Register with a valid email, username and password | PASS | 00:04 | [img](../evidence/testing-2026-11-22-full/F02-auth/04-04.png) |
| 05 | FR-2.2.1 | Log out | PASS | 00:06 | [img](../evidence/testing-2026-11-22-full/F02-auth/05-05.png) |
| 06 | FR-2.2.1 | Log in with a wrong password | PASS | 00:07 | [img](../evidence/testing-2026-11-22-full/F02-auth/06-06.png) |
| 07 | FR-2.2.1 | Log in with the email | PASS | 00:09 | [img](../evidence/testing-2026-11-22-full/F02-auth/07-07.png) |
| 08 | FR-2.2.1 | Log out, then log in with the username in upper case | PASS | 00:11 | [img](../evidence/testing-2026-11-22-full/F02-auth/08-08.png) |
| 09 | FR-2.2.1 | Register again with the same email | PASS | 00:14 | [img](../evidence/testing-2026-11-22-full/F02-auth/09-09.png) |
| 10 | FR-2.2.1 | Click "เข้าสู่ระบบด้วย Google" | PASS | 00:15 | [img](../evidence/testing-2026-11-22-full/F02-auth/10-10.png) |
| 11 | FR-2.2.1 | Cleanup: sign in and delete the test account (API) | PASS | 00:17 | [img](../evidence/testing-2026-11-22-full/F02-auth/11-11.png) |

## F03-access-control: Guests and normal users cannot reach protected pages and APIs; users cannot see each other's drafts

Video: [F03-access-control/F03-access-control.webm](../evidence/testing-2026-11-22-full/F03-access-control/F03-access-control.webm)

| Step | FR | Function tested | Result | Video time | Screenshot |
| --- | --- | --- | --- | --- | --- |
| 01 | BidPrep FR-4.7.1; FR-2.2.1 | Guest opens /profile | PASS | 00:00 | [img](../evidence/testing-2026-11-22-full/F03-access-control/01-01.png) |
| 02 | ASVS (no SRS FR) | Guest opens /admin | PASS | 00:01 | [img](../evidence/testing-2026-11-22-full/F03-access-control/02-02.png) |
| 03 | BidPrep FR-4.7.1 | Guest calls the drafts API and the admin API | PASS | 00:02 | [img](../evidence/testing-2026-11-22-full/F03-access-control/03-03.png) |
| 04 | ASVS (no SRS FR) | Sign in as a normal user and open /admin | PASS | 00:03 | [img](../evidence/testing-2026-11-22-full/F03-access-control/04-04.png) |
| 05 | ASVS (no SRS FR) | Normal user calls the admin API | PASS | 00:05 | [img](../evidence/testing-2026-11-22-full/F03-access-control/05-05.png) |
| 06 | BidPrep FR-4.7.1 | User A creates a draft (API); user B opens its URL in the browser and via the API | PASS | 00:05 | [img](../evidence/testing-2026-11-22-full/F03-access-control/06-06.png) |
| 07 | FR-4.2.1 | Check the security headers of a normal page response | PASS | 00:11 | [img](../evidence/testing-2026-11-22-full/F03-access-control/07-07.png) |
| 08 | — | Cleanup: delete both test accounts | PASS | 00:12 | [img](../evidence/testing-2026-11-22-full/F03-access-control/08-08.png) |

## F04-profile: Edit the company profile, validation, persistence, delete company data, delete account

Video: [F04-profile/F04-profile.webm](../evidence/testing-2026-11-22-full/F04-profile/F04-profile.webm)

| Step | FR | Function tested | Result | Video time | Screenshot |
| --- | --- | --- | --- | --- | --- |
| 01 | FR-2.2.1; FR-2.2.2; BidPrep FR-4.1.2 | Sign in and open the profile page | PASS | 00:00 | [img](../evidence/testing-2026-11-22-full/F04-profile/01-01.png) |
| 02 | FR-2.2.2; FR-2.2.3; BidPrep FR-4.1.1 | Fill company name, capital, highest past-project value and capacity | PASS | 00:02 | [img](../evidence/testing-2026-11-22-full/F04-profile/02-02.png) |
| 03 | BidPrep FR-4.1.1; FR-2.2.2 | Fill registration number, signatory and address | PASS | 00:03 | [img](../evidence/testing-2026-11-22-full/F04-profile/03-03.png) |
| 04 | BidPrep FR-4.1.1; FR-2.2.3 | Add a past project and fill it in | PASS | 00:04 | [img](../evidence/testing-2026-11-22-full/F04-profile/04-04.png) |
| 05 | FR-2.2.2; BidPrep FR-4.1.1 | Pick three skills and one certification | PASS | 00:05 | [img](../evidence/testing-2026-11-22-full/F04-profile/05-05.png) |
| 06 | FR-2.2.3; FR-2.3.3 | Turn email notifications on and set threshold and frequency | PASS | 00:06 | [img](../evidence/testing-2026-11-22-full/F04-profile/06-06.png) |
| 07 | FR-2.2.3; BidPrep FR-4.1.1 | Click "บันทึกข้อมูลโปรไฟล์" | PASS | 00:06 | [img](../evidence/testing-2026-11-22-full/F04-profile/07-07.png) |
| 08 | FR-2.2.2; FR-2.2.3 | Reload the page | PASS | 00:08 | [img](../evidence/testing-2026-11-22-full/F04-profile/08-08.png) |
| 09 | FR-2.2.2 | Enter a negative capital and save | PASS | 00:09 | [img](../evidence/testing-2026-11-22-full/F04-profile/09-09.png) |
| 10 | FR-2.2.3; BidPrep FR-4.1.2 | Remove the past project | PASS | 00:12 | [img](../evidence/testing-2026-11-22-full/F04-profile/10-10.png) |
| 11 | BidPrep FR-4.7.2; FR-2.2.3 | Create a draft (API), then click "ลบข้อมูลบริษัท" and confirm | PASS | 00:14 | [img](../evidence/testing-2026-11-22-full/F04-profile/11-11.png) |
| 12 | BidPrep FR-4.7.2 | Click "ลบบัญชีผู้ใช้" and confirm | PASS | 00:21 | [img](../evidence/testing-2026-11-22-full/F04-profile/12-12.png) |
| 13 | BidPrep FR-4.7.2 | Try to sign in with the deleted account | PASS | 00:23 | [img](../evidence/testing-2026-11-22-full/F04-profile/13-13.png) |

## F05-tor-detail: Signed-in user reads a TOR: summary, qualification checklist (own status), prepare-draft link, dashboard

Video: [F05-tor-detail/F05-tor-detail.webm](../evidence/testing-2026-11-22-full/F05-tor-detail/F05-tor-detail.webm)

| Step | FR | Function tested | Result | Video time | Screenshot |
| --- | --- | --- | --- | --- | --- |
| 01 | FR-2.1.3; BidPrep FR-4.2.1 | Sign in and open a TOR detail page | PASS | 00:00 | [img](../evidence/testing-2026-11-22-full/F05-tor-detail/01-01.png) |
| 03 | BidPrep FR-4.2.1; FR-2.1.2 | Scroll to the qualification checklist card | PASS | 00:03 | [img](../evidence/testing-2026-11-22-full/F05-tor-detail/02-03.png) |
| 04 | BidPrep FR-4.2.3 | Mark the first item "ผ่าน" | PASS | 00:04 | [img](../evidence/testing-2026-11-22-full/F05-tor-detail/03-04.png) |
| 05 | BidPrep FR-4.2.3 | Change the first item to "ไม่ผ่าน", then press it again | PASS | 00:07 | [img](../evidence/testing-2026-11-22-full/F05-tor-detail/04-05.png) |
| 06 | BidPrep FR-4.2.1 | Page through the checklist ("ถัดไป →") | PASS | 00:10 | [img](../evidence/testing-2026-11-22-full/F05-tor-detail/05-06.png) |
| 07 | BidPrep FR-4.3.3 | Click "เตรียมร่างข้อเสนอ" | PASS | 00:12 | [img](../evidence/testing-2026-11-22-full/F05-tor-detail/06-07.png) |
| 08 | FR-1.1.2 | Open the document page of the TOR | PASS | 00:13 | [img](../evidence/testing-2026-11-22-full/F05-tor-detail/07-08.png) |
| 09 | FR-4.2.1 | Open the dashboard | PASS | 00:15 | [img](../evidence/testing-2026-11-22-full/F05-tor-detail/08-09.png) |
| 10 | — | Cleanup: delete the test account | PASS | 00:20 | [img](../evidence/testing-2026-11-22-full/F05-tor-detail/09-10.png) |

## F06-bidprep-draft: BidPrep: create a draft, edit, sections, checklist gate, export DOCX, delete

Video: [F06-bidprep-draft/F06-bidprep-draft.webm](../evidence/testing-2026-11-22-full/F06-bidprep-draft/F06-bidprep-draft.webm)

| Step | FR | Function tested | Result | Video time | Screenshot |
| --- | --- | --- | --- | --- | --- |
| 01 | BidPrep FR-4.3.3; BidPrep FR-4.1.1 | Sign in, fill a minimal profile (API) and open "เตรียมข้อเสนอ" | PASS | 00:00 | [img](../evidence/testing-2026-11-22-full/F06-bidprep-draft/01-01.png) |
| 02 | BidPrep FR-4.3.3 | Create a draft with an unknown TOR id | PASS | 00:03 | [img](../evidence/testing-2026-11-22-full/F06-bidprep-draft/02-02.png) |
| 03 | BidPrep FR-4.3.3 | Create a draft for a real TOR | PASS | 00:05 | [img](../evidence/testing-2026-11-22-full/F06-bidprep-draft/03-03.png) |
| 04 | BidPrep FR-4.3.3 | Edit the title and the first section, then save | PASS | 00:07 | [img](../evidence/testing-2026-11-22-full/F06-bidprep-draft/04-04.png) |
| 05 | BidPrep FR-4.3.3 | Add a section | PASS | 00:08 | [img](../evidence/testing-2026-11-22-full/F06-bidprep-draft/05-05.png) |
| 06 | BidPrep FR-4.3.3 | Delete the added section | PASS | 00:10 | [img](../evidence/testing-2026-11-22-full/F06-bidprep-draft/06-06.png) |
| 07 | BidPrep FR-4.4.1; BidPrep FR-4.2.1 | Save, then look at the export button before the checklist passes | PASS | 00:11 | [img](../evidence/testing-2026-11-22-full/F06-bidprep-draft/07-07.png) |
| 08 | BidPrep FR-4.2.1 | Open the checklist tab | PASS | 00:12 | [img](../evidence/testing-2026-11-22-full/F06-bidprep-draft/08-08.png) |
| 09 | BidPrep FR-4.2.3 | Mark one item "ไม่ผ่าน" | PASS | 00:13 | [img](../evidence/testing-2026-11-22-full/F06-bidprep-draft/09-09.png) |
| 10 | BidPrep FR-4.2.3; BidPrep FR-4.4.1 | Mark every item "ผ่าน" on all pages | PASS | 00:15 | [img](../evidence/testing-2026-11-22-full/F06-bidprep-draft/10-10.png) |
| 11 | BidPrep FR-4.4.1; BidPrep FR-4.3.4 | Download the DOCX (saving first if the page reports unsaved changes) | PASS | 00:29 | [img](../evidence/testing-2026-11-22-full/F06-bidprep-draft/11-11.png) |
| 12 | BidPrep FR-4.3.3 | Return to the list and open the saved draft | PASS | 00:30 | [img](../evidence/testing-2026-11-22-full/F06-bidprep-draft/12-12.png) |
| 13 | BidPrep FR-4.7.2 | Delete the draft | PASS | 00:33 | [img](../evidence/testing-2026-11-22-full/F06-bidprep-draft/13-13.png) |
| 14 | — | Cleanup: delete the test account | PASS | 00:36 | [img](../evidence/testing-2026-11-22-full/F06-bidprep-draft/14-14.png) |

## F07-bidprep-ai: BidPrep: generate an AI draft (queued job, local model), TOR with a small scope

Video: [F07-bidprep-ai/F07-bidprep-ai.webm](../evidence/testing-2026-11-22-full/F07-bidprep-ai/F07-bidprep-ai.webm)

| Step | FR | Function tested | Result | Video time | Screenshot |
| --- | --- | --- | --- | --- | --- |
| 01 | BidPrep FR-4.3.4 | Sign in, fill a profile and open "เตรียมข้อเสนอ" | PASS | 00:00 | [img](../evidence/testing-2026-11-22-full/F07-bidprep-ai/01-01.png) |
| 02 | BidPrep FR-4.3.1 | Enter a TOR id and click "สร้างร่างด้วย AI" | PASS | 00:02 | [img](../evidence/testing-2026-11-22-full/F07-bidprep-ai/02-02.png) |
| 03 | BidPrep FR-4.3.1 | Wait for the job to finish (up to 5.5 minutes) | PASS | 00:04 | [img](../evidence/testing-2026-11-22-full/F07-bidprep-ai/03-03.png) |
| 04 | BidPrep FR-4.3.1; BidPrep FR-4.3.2 | Open the AI draft | PASS | 01:20 | [img](../evidence/testing-2026-11-22-full/F07-bidprep-ai/04-04.png) |
| 05 | BidPrep FR-4.7.2 | Cleanup: delete the test account and its drafts | PASS | 01:21 | [img](../evidence/testing-2026-11-22-full/F07-bidprep-ai/05-05.png) |

## F07b-bidprep-ai-large-tor: BidPrep: generate an AI draft for a TOR with a large scope (47 items)

Video: [F07b-bidprep-ai-large-tor/F07b-bidprep-ai-large-tor.webm](../evidence/testing-2026-11-22-full/F07b-bidprep-ai-large-tor/F07b-bidprep-ai-large-tor.webm)

| Step | FR | Function tested | Result | Video time | Screenshot |
| --- | --- | --- | --- | --- | --- |
| 01 | BidPrep FR-4.3.4 | Sign in, fill a profile and open "เตรียมข้อเสนอ" | PASS | 00:00 | [img](../evidence/testing-2026-11-22-full/F07b-bidprep-ai-large-tor/01-01.png) |
| 02 | BidPrep FR-4.3.1 | Enter a TOR id and click "สร้างร่างด้วย AI" | PASS | 00:02 | [img](../evidence/testing-2026-11-22-full/F07b-bidprep-ai-large-tor/02-02.png) |
| 03 | BidPrep FR-4.3.1 | Wait for the job to finish (up to 5.5 minutes) | PASS | 00:04 | [img](../evidence/testing-2026-11-22-full/F07b-bidprep-ai-large-tor/03-03.png) |
| 04 | BidPrep FR-4.3.1; BidPrep FR-4.3.2 | Open the AI draft | PASS | 01:14 | [img](../evidence/testing-2026-11-22-full/F07b-bidprep-ai-large-tor/04-04.png) |
| 05 | BidPrep FR-4.7.2 | Cleanup: delete the test account and its drafts | PASS | 01:15 | [img](../evidence/testing-2026-11-22-full/F07b-bidprep-ai-large-tor/05-05.png) |

## F08-admin: Admin console: ingestion status, health, review queue (read only, nothing is triggered)

Video: [F08-admin/F08-admin.webm](../evidence/testing-2026-11-22-full/F08-admin/F08-admin.webm)

| Step | FR | Function tested | Result | Video time | Screenshot |
| --- | --- | --- | --- | --- | --- |
| 01 | FR-1.1.1 | Sign in as an admin | PASS | 00:00 | [img](../evidence/testing-2026-11-22-full/F08-admin/01-01.png) |
| 02 | FR-1.1.1; NFR-3 | Open /admin | PASS | 00:02 | [img](../evidence/testing-2026-11-22-full/F08-admin/02-02.png) |
| 03 | FR-1.2.1; FR-1.2.3 | Read the review queue | PASS | 00:03 | [img](../evidence/testing-2026-11-22-full/F08-admin/03-03.png) |
| 04 | FR-1.2.1; FR-1.2.3 | Filter the queue by reason | PASS | 00:10 | [img](../evidence/testing-2026-11-22-full/F08-admin/04-04.png) |
| 05 | FR-1.2.1 | Search the queue for text that matches nothing | PASS | 00:13 | [img](../evidence/testing-2026-11-22-full/F08-admin/05-05.png) |
| 06 | FR-1.1.1; NFR-3 | Admin API status call | PASS | 00:15 | [img](../evidence/testing-2026-11-22-full/F08-admin/06-06.png) |
| 07 | — | Cleanup: delete the admin test account | PASS | 00:16 | [img](../evidence/testing-2026-11-22-full/F08-admin/07-07.png) |

## Other evidence

- Exported DOCX: [../evidence/testing-2026-11-22-full/F06-bidprep-draft/exported-draft.docx](../evidence/testing-2026-11-22-full/F06-bidprep-draft/exported-draft.docx)
- Responsive screenshots at 360/768/1280 px, and `/projects` at 360 px after the fix: [screenshots-2026-11-22/](../evidence/screenshots-2026-11-22/)
- API smoke test (34 steps): [e2e-test-2026-11-22.md](../e2e-test-2026-11-22.md)

## Not covered (needs credentials, real mail, or would change live data)

- Complete Google sign-in (only the redirect is tested, F02-10; FR-2.2.1)
- "ทดสอบส่งอีเมล" and match-score email delivery (FR-2.3.3)
- Trigger of the ingestion pipeline and classification override from the admin page (FR-1.1.1, FR-1.2.2)
- Opening the DOCX in Microsoft Word (BidPrep FR-4.4.1)
