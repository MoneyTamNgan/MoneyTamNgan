# Documentation index

Requirement ids: main SRS `FR-1.x` … `FR-4.2.x` and `NFR-1` … `NFR-6`. Bid Preparation ids are `BidPrep FR-4.x`. Convention: [traceability.md](traceability.md#requirement-id-convention).

## Requirements and design

- [MoneyTamNgan SRS](https://docs.google.com/document/d/1_o6RmB_G54MWgXHGiePvBzy-vLkhECAzDnhtU15rz0A/edit): main SRS
- [Bid Prep Ad Hoc SRS](https://docs.google.com/document/d/1rIqJhvAdZuRWVMVB5JdqmpVUwuwbRRzyAZyfrpj0PH4/edit) (Thai) and [SRS adhoc requirement](https://docs.google.com/document/d/1u8PlICl8XWIjGJUca1KImYh5keUNDkgUoAU73ERks8A/edit) (English)
- [traceability.md](traceability.md): FR to card, pull request, test and evidence
- [design/README.md](design/README.md): design document index
- [audit/README.md](audit/README.md): audit pack (architecture, ER diagram, design patterns, controls, incident response, privacy notice)
- [audit/05-incident-response-runbook.md](audit/05-incident-response-runbook.md), [audit/06-privacy-notice.md](audit/06-privacy-notice.md)

## Testing

- [testing/test-plan.md](testing/test-plan.md): UI test plan (every user function as a flow, with FR ids)
- [testing/test-sheet.md](testing/test-sheet.md) and [testing/test-sheet.csv](testing/test-sheet.csv): test sheet with a video and screenshot for every step
- [testing/test-sheet-ai-fallback.md](testing/test-sheet-ai-fallback.md) and [testing/test-sheet-ai-fallback.csv](testing/test-sheet-ai-fallback.csv): F07 and F07b after Vertex refuses
- [testing/test-sheet-rerun-ai.csv](testing/test-sheet-rerun-ai.csv): agy re-run of the same AI steps
- [testing/evidence-index.md](testing/evidence-index.md): every function, its FR id, video and screenshot
- [testing/review-and-defects.md](testing/review-and-defects.md): independent review and defects, tagged with FR ids
- [evidence/testing-2026-11-22-full/](evidence/testing-2026-11-22-full/): videos and screenshots for the 86-step run
- [evidence/testing-2026-11-22/](evidence/testing-2026-11-22/): earlier run kept as history

## Start here

- [handover.md](handover.md): owner, external services, rotating secrets, known limitations
- [user-guide.md](user-guide.md): short guide for end users
- [local-deployment.md](local-deployment.md): start, stop, rollback on the demo machine (NFR-5)
- [reference.md](reference.md): full technical guide (pipeline, Vertex, AI provider fallback, OCR, CI/CD)
- [agy-bridge.md](agy-bridge.md): demo AI fallback
- [api/openapi.yaml](api/openapi.yaml): API contract
- [api/README.md](api/README.md): how to read and validate the contract
- [API_VALIDATION.md](API_VALIDATION.md): input validation dictionary (ASVS V2.1.1)

## Architecture

- [tor-flow.md](tor-flow.md), [pipeline.md](pipeline.md), [diagrams/](diagrams/)

## Bid Preparation Assistant (BidPrep)

- [bid-prep-decisions.md](bid-prep-decisions.md), [company-profile.md](company-profile.md), [bid-draft-editor-export-report.md](bid-draft-editor-export-report.md)
- [acceptance-bidprep-2026-11.md](acceptance-bidprep-2026-11.md): acceptance results table
- [demo-script-bidprep.md](demo-script-bidprep.md): demo script for the BidPrep part

## Test reports

- [e2e-test-2026-11-22.md](e2e-test-2026-11-22.md), [e2e-test-2026-11-19.md](e2e-test-2026-11-19.md), [connectivity-test-2026-11-19.md](connectivity-test-2026-11-19.md), [card-delivery-status-2026-11-16.md](card-delivery-status-2026-11-16.md)

## Security

- [security/README.md](security/README.md), [THREAT_MODEL](security/THREAT_MODEL.md), [ASVS_CHECKLIST](security/ASVS_CHECKLIST.md), [RBAC_SPEC](security/RBAC_SPEC.md)
- [security/AUTHENTICATION.md](security/AUTHENTICATION.md), [security/ADMIN_ACCESS.md](security/ADMIN_ACCESS.md), [security/VULNERABILITY_MGMT.md](security/VULNERABILITY_MGMT.md)
- [security/bid-prep-fr-4.7.md](security/bid-prep-fr-4.7.md)
- [security-assignment-audit-2026-11-19.md](security-assignment-audit-2026-11-19.md)

## Presentation

- [presentation/demo-script-en-10min.md](presentation/demo-script-en-10min.md), [presentation/](presentation/)
