# Evidence index: every function, with its video and screenshot

Run: 22 Nov 2026, `v1.0.0` plus the fixes of PR #242 and #243, demo machine, real Atlas. 85 of 85 steps pass ([test-sheet.md](test-sheet.md)). One video per flow; each row gives the time in the video and the screenshot of that step. The AI draft flows (F07, F07b) used the `agy` CLI as the AI, not the local model; see [review-and-defects.md](review-and-defects.md) section 4. Evidence from before the fixes (81/85) is kept in [../evidence/testing-2026-11-22/](../evidence/testing-2026-11-22/).

## F01-guest-browse: Guest browses TORs, searches, filters, pages, opens detail and analytics (no login)

Video: [F01-guest-browse/F01-guest-browse.webm](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F01-guest-browse/F01-guest-browse.webm)

| Step | Function tested | Result | Video time | Screenshot |
|---|---|---|---|---|
| 01 | Open the dashboard as a guest | PASS | 00:00 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F01-guest-browse/01-01.png) |
| 02 | Click the second hero slide indicator | PASS | 00:02 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F01-guest-browse/02-02.png) |
| 03 | Type a keyword in the search box | PASS | 00:04 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F01-guest-browse/03-03.png) |
| 04 | Go to the next page of results | PASS | 00:06 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F01-guest-browse/04-04.png) |
| 05 | Use the filters: software toggle, agency, bidding status, minimum budget, sort | PASS | 00:07 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F01-guest-browse/05-05.png) |
| 06 | Click the first TOR card as a guest | PASS | 00:12 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F01-guest-browse/06-06.png) |
| 07 | Open a TOR detail page directly as a guest | PASS | 00:15 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F01-guest-browse/07-07.png) |
| 08 | Open the document page of the TOR | PASS | 00:16 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F01-guest-browse/08-08.png) |
| 09 | Open Analytics and change a filter | PASS | 00:18 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F01-guest-browse/09-09.png) |
| 10 | Clear the filters | PASS | 00:19 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F01-guest-browse/10-10.png) |
| 11 | Switch the chart mode to "ความพร้อมเอกสาร" and back | PASS | 00:21 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F01-guest-browse/11-11.png) |
| 12 | Export the analytics as CSV and as JSON | PASS | 00:22 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F01-guest-browse/12-12.png) |
| 13 | Toggle the theme and collapse the sidebar | PASS | 00:24 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F01-guest-browse/13-13.png) |

## F02-auth: Register, log out, log in by email and username, error cases, Google redirect

Video: [F02-auth/F02-auth.webm](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F02-auth/F02-auth.webm)

| Step | Function tested | Result | Video time | Screenshot |
|---|---|---|---|---|
| 01 | Open the sign-in page | PASS | 00:00 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F02-auth/01-01.png) |
| 02 | Switch to "สร้างบัญชี" and submit with mismatching passwords | PASS | 00:01 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F02-auth/02-02.png) |
| 03 | Submit with a password shorter than 15 characters | PASS | 00:02 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F02-auth/03-03.png) |
| 04 | Register with a valid email, username and password | PASS | 00:04 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F02-auth/04-04.png) |
| 05 | Log out | PASS | 00:06 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F02-auth/05-05.png) |
| 06 | Log in with a wrong password | PASS | 00:07 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F02-auth/06-06.png) |
| 07 | Log in with the email | PASS | 00:09 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F02-auth/07-07.png) |
| 08 | Log out, then log in with the username in upper case | PASS | 00:13 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F02-auth/08-08.png) |
| 09 | Register again with the same email | PASS | 00:15 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F02-auth/09-09.png) |
| 10 | Click "เข้าสู่ระบบด้วย Google" | PASS | 00:18 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F02-auth/10-10.png) |
| 11 | Cleanup: sign in and delete the test account (API) | PASS | 00:19 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F02-auth/11-11.png) |

## F03-access-control: Guests and normal users cannot reach protected pages and APIs; users cannot see each other's drafts

Video: [F03-access-control/F03-access-control.webm](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F03-access-control/F03-access-control.webm)

| Step | Function tested | Result | Video time | Screenshot |
|---|---|---|---|---|
| 01 | Guest opens /profile | PASS | 00:00 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F03-access-control/01-01.png) |
| 02 | Guest opens /admin | PASS | 00:01 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F03-access-control/02-02.png) |
| 03 | Guest calls the drafts API and the admin API | PASS | 00:02 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F03-access-control/03-03.png) |
| 04 | Sign in as a normal user and open /admin | PASS | 00:03 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F03-access-control/04-04.png) |
| 05 | Normal user calls the admin API | PASS | 00:05 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F03-access-control/05-05.png) |
| 06 | User A creates a draft (API); user B opens its URL in the browser and via the API | PASS | 00:05 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F03-access-control/06-06.png) |
| 07 | Check the security headers of a normal page response | PASS | 00:11 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F03-access-control/07-07.png) |
| 08 | Cleanup: delete both test accounts | PASS | 00:12 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F03-access-control/08-08.png) |

## F04-profile: Edit the company profile, validation, persistence, delete company data, delete account

Video: [F04-profile/F04-profile.webm](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F04-profile/F04-profile.webm)

| Step | Function tested | Result | Video time | Screenshot |
|---|---|---|---|---|
| 01 | Sign in and open the profile page | PASS | 00:00 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F04-profile/01-01.png) |
| 02 | Fill company name, capital, highest past-project value and capacity | PASS | 00:02 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F04-profile/02-02.png) |
| 03 | Fill registration number, signatory and address | PASS | 00:03 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F04-profile/03-03.png) |
| 04 | Add a past project and fill it in | PASS | 00:04 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F04-profile/04-04.png) |
| 05 | Pick three skills and one certification | PASS | 00:05 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F04-profile/05-05.png) |
| 06 | Turn email notifications on and set threshold and frequency | PASS | 00:06 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F04-profile/06-06.png) |
| 07 | Click "บันทึกข้อมูลโปรไฟล์" | PASS | 00:07 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F04-profile/07-07.png) |
| 08 | Reload the page | PASS | 00:08 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F04-profile/08-08.png) |
| 09 | Enter a negative capital and save | PASS | 00:10 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F04-profile/09-09.png) |
| 10 | Remove the past project | PASS | 00:12 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F04-profile/10-10.png) |
| 11 | Create a draft (API), then click "ลบข้อมูลบริษัท" and confirm | PASS | 00:15 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F04-profile/11-11.png) |
| 12 | Click "ลบบัญชีผู้ใช้" and confirm | PASS | 00:21 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F04-profile/12-12.png) |
| 13 | Try to sign in with the deleted account | PASS | 00:23 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F04-profile/13-13.png) |

## F05-tor-detail: Signed-in user reads a TOR: summary, qualification checklist (own status), prepare-draft link, dashboard

Video: [F05-tor-detail/F05-tor-detail.webm](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F05-tor-detail/F05-tor-detail.webm)

| Step | Function tested | Result | Video time | Screenshot |
|---|---|---|---|---|
| 01 | Sign in and open a TOR detail page | PASS | 00:00 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F05-tor-detail/01-01.png) |
| 03 | Scroll to the qualification checklist card | PASS | 00:03 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F05-tor-detail/02-03.png) |
| 04 | Mark the first item "ผ่าน" | PASS | 00:04 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F05-tor-detail/03-04.png) |
| 05 | Change the first item to "ไม่ผ่าน", then press it again | PASS | 00:07 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F05-tor-detail/04-05.png) |
| 06 | Page through the checklist ("ถัดไป →") | PASS | 00:11 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F05-tor-detail/05-06.png) |
| 07 | Click "เตรียมร่างข้อเสนอ" | PASS | 00:12 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F05-tor-detail/06-07.png) |
| 08 | Open the document page of the TOR | PASS | 00:13 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F05-tor-detail/07-08.png) |
| 09 | Open the dashboard | PASS | 00:15 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F05-tor-detail/08-09.png) |
| 10 | Cleanup: delete the test account | PASS | 00:20 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F05-tor-detail/09-10.png) |

## F06-bidprep-draft: BidPrep: create a draft, edit, sections, checklist gate, export DOCX, delete

Video: [F06-bidprep-draft/F06-bidprep-draft.webm](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F06-bidprep-draft/F06-bidprep-draft.webm)

| Step | Function tested | Result | Video time | Screenshot |
|---|---|---|---|---|
| 01 | Sign in, fill a minimal profile (API) and open "เตรียมข้อเสนอ" | PASS | 00:00 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F06-bidprep-draft/01-01.png) |
| 02 | Create a draft with an unknown TOR id | PASS | 00:03 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F06-bidprep-draft/02-02.png) |
| 03 | Create a draft for a real TOR | PASS | 00:04 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F06-bidprep-draft/03-03.png) |
| 04 | Edit the title and the first section, then save | PASS | 00:07 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F06-bidprep-draft/04-04.png) |
| 05 | Add a section | PASS | 00:09 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F06-bidprep-draft/05-05.png) |
| 06 | Delete the added section | PASS | 00:10 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F06-bidprep-draft/06-06.png) |
| 07 | Save, then look at the export button before the checklist passes | PASS | 00:11 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F06-bidprep-draft/07-07.png) |
| 08 | Open the checklist tab | PASS | 00:12 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F06-bidprep-draft/08-08.png) |
| 09 | Mark one item "ไม่ผ่าน" | PASS | 00:13 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F06-bidprep-draft/09-09.png) |
| 10 | Mark every item "ผ่าน" on all pages | PASS | 00:16 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F06-bidprep-draft/10-10.png) |
| 11 | Download the DOCX (saving first if the page reports unsaved changes) | PASS | 00:30 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F06-bidprep-draft/11-11.png) |
| 12 | Return to the list and open the saved draft | PASS | 00:31 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F06-bidprep-draft/12-12.png) |
| 13 | Delete the draft | PASS | 00:34 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F06-bidprep-draft/13-13.png) |
| 14 | Cleanup: delete the test account | PASS | 00:37 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F06-bidprep-draft/14-14.png) |

## F07-bidprep-ai: BidPrep: generate an AI draft (queued job, local model), TOR with a small scope

Video: [F07-bidprep-ai/F07-bidprep-ai.webm](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F07-bidprep-ai/F07-bidprep-ai.webm)

| Step | Function tested | Result | Video time | Screenshot |
|---|---|---|---|---|
| 01 | Sign in, fill a profile and open "เตรียมข้อเสนอ" | PASS | 00:00 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F07-bidprep-ai/01-01.png) |
| 02 | Enter a TOR id and click "สร้างร่างด้วย AI" | PASS | 00:02 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F07-bidprep-ai/02-02.png) |
| 03 | Wait for the job to finish (up to 5.5 minutes) | PASS | 00:04 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F07-bidprep-ai/03-03.png) |
| 04 | Open the AI draft | PASS | 02:05 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F07-bidprep-ai/04-04.png) |
| 05 | Cleanup: delete the test account and its drafts | PASS | 02:06 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F07-bidprep-ai/05-05.png) |

## F07b-bidprep-ai-large-tor: BidPrep: generate an AI draft for a TOR with a large scope (47 items)

Video: [F07b-bidprep-ai-large-tor/F07b-bidprep-ai-large-tor.webm](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F07b-bidprep-ai-large-tor/F07b-bidprep-ai-large-tor.webm)

| Step | Function tested | Result | Video time | Screenshot |
|---|---|---|---|---|
| 01 | Sign in, fill a profile and open "เตรียมข้อเสนอ" | PASS | 00:00 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F07b-bidprep-ai-large-tor/01-01.png) |
| 02 | Enter a TOR id and click "สร้างร่างด้วย AI" | PASS | 00:02 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F07b-bidprep-ai-large-tor/02-02.png) |
| 03 | Wait for the job to finish (up to 5.5 minutes) | PASS | 00:04 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F07b-bidprep-ai-large-tor/03-03.png) |
| 04 | Open the AI draft | PASS | 01:23 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F07b-bidprep-ai-large-tor/04-04.png) |
| 05 | Cleanup: delete the test account and its drafts | PASS | 01:24 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F07b-bidprep-ai-large-tor/05-05.png) |

## F08-admin: Admin console: ingestion status, health, review queue (read only, nothing is triggered)

Video: [F08-admin/F08-admin.webm](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F08-admin/F08-admin.webm)

| Step | Function tested | Result | Video time | Screenshot |
|---|---|---|---|---|
| 01 | Sign in as an admin | PASS | 00:00 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F08-admin/01-01.png) |
| 02 | Open /admin | PASS | 00:02 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F08-admin/02-02.png) |
| 03 | Read the review queue | PASS | 00:03 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F08-admin/03-03.png) |
| 04 | Filter the queue by reason | PASS | 00:10 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F08-admin/04-04.png) |
| 05 | Search the queue for text that matches nothing | PASS | 00:12 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F08-admin/05-05.png) |
| 06 | Admin API status call | PASS | 00:15 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F08-admin/06-06.png) |
| 07 | Cleanup: delete the admin test account | PASS | 00:16 | [img](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F08-admin/07-07.png) |

## Other evidence

- Exported DOCX: [https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F06-bidprep-draft/exported-draft.docx](https://github.com/MoneyTamNgan/MoneyTamNgan/blob/docs/ui-testing-evidence/docs/evidence/testing-2026-11-22-full/F06-bidprep-draft/exported-draft.docx)
- Responsive screenshots at 360/768/1280 px: [screenshots-2026-11-22/](https://github.com/MoneyTamNgan/MoneyTamNgan/tree/docs/ui-testing-evidence/docs/evidence/screenshots-2026-11-22)
- API smoke test (34 steps), 22 Nov: [e2e-test-2026-11-22.md](../e2e-test-2026-11-22.md)

## Not covered (needs credentials, real mail, or would change live data)

- Complete Google sign-in (only the redirect is tested, F02-10)
- "ทดสอบส่งอีเมล" and match-score email delivery
- Trigger of the ingestion pipeline and classification override from the admin page
- Opening the DOCX in Microsoft Word
