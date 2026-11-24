# BidPrep: decisions on the SRS questions

Ids in the table below are Bid Preparation SRS ids (`BidPrep FR-4.x`), not main SRS Epic 4. Convention: [traceability.md](traceability.md#requirement-id-convention).

These are the answers the **team** gave on 16 November 2026 to the eight questions in "SRS adhoc requirement" v0.1 (Bid Preparation Assistant). They are the defaults the system ships with. **The customer has not confirmed them in writing yet** (#143); until they do, treat each as an assumption.

| # | Question | Decision | Where it shows in the system |
|---|---|---|---|
| 1 | Does the system only prepare documents, with the seller submitting in e-GP? | Yes, as built | No e-GP client in the code; the UI and DOCX say the seller submits (STRIDE TH-15, TH-18) |
| 2 | Draft the price proposal too? | No | Out of scope; the seller writes prices |
| 3 | Should the AI draft everything, or only what the profile supports? | Only what the profile and the TOR support; the rest is left as `[to fill in: ...]` | BidPrep FR-4.3, issue #139 |
| 4 | Which users get this? | Every logged-in user | Every BidPrep route needs a session (BidPrep FR-4.7) |
| 5 | Must an admin review a draft before export? | No | Export is available to the owner of the draft |
| 6 | How long is company data and drafts kept? | Until the user deletes them. No automatic expiry | [bid-prep-fr-4.7.md](security/bid-prep-fr-4.7.md), TH-14, ASVS V14 |
| 7 | What was agreed with the previous project manager that is not written down? | Unknown whether anything was | Nothing to record; ask the customer to say so if there is |
| 8 | Real bid documents as templates and test data? | Not supplied. Use the TORs the pipeline already fetches | Tests and demo use fetched TORs, not sellers' own bid documents |

If the customer disagrees with any row, change the row, the code or document it points to, and the matching card.
