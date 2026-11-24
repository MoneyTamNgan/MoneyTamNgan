# MoneyTamNgan: Tech Stack (ทั้งระบบ)

เอกสารสรุปเทคโนโลยีของทั้งระบบ รวบรวมจาก `package.json`, `Dockerfile*`, `docker-compose.yml`, `.env.example`, `.github/workflows/` และโครงสร้างโค้ดจริง

ระบบติดตามโครงการจัดซื้อจัดจ้างด้านซอฟต์แวร์ของไทยจาก e-GP: ดึงข้อมูลโครงการ, ดาวน์โหลดและอ่านเอกสาร TOR (text + OCR ภาษาไทย), สรุปด้วย Vertex AI (Gemini), แสดงผลบน dashboard (ค้นหา, matching, analytics) และมี Bid Preparation Assistant ช่วยเตรียมเอกสารเสนอราคา (ไม่ยื่นซองแทนผู้ใช้)

## 1. ภาพรวมสถาปัตยกรรม

```
 e-GP (RSS / API / เว็บ)                       ผู้ใช้ (Browser)
        │                                            │
        ▼                                            ▼
 ┌────────────┐   ┌────────────┐          ┌─────────────────────┐
 │  scraper   │   │ scheduler  │─ HTTP ──▶│  app (Next.js 16)   │
 │ (Puppeteer)│   │ 06/12/18น. │          │  UI + /api/* routes │
 └─────┬──────┘   └────────────┘          └──────────┬──────────┘
       │ job queue                                   │
       ▼                                             ▼
 ┌────────────┐      ┌──────────────────────────────────────┐
 │  worker    │─────▶│ MongoDB 7 (replica set rs0 / Atlas)  │
 │ OCR + AI   │      │ Mongoose models + Vector Search      │
 └─────┬──────┘      └──────────────────────────────────────┘
       │
       ├─▶ Vertex AI (Gemini 2.5 Flash + embeddings)
       │     └─ fallback: Ollama / agy bridge (demo เท่านั้น)
       └─▶ Storage: local volume หรือ Google Cloud Storage
```

คอนเทนเนอร์ใน `docker-compose.yml`: `mongo`, `app`, `scraper` (รันครั้งเดียว), `worker` (poll คิวต่อเนื่อง), `scheduler`

## 2. Frontend

| ส่วน | เทคโนโลยี | หมายเหตุ |
| --- | --- | --- |
| Framework | Next.js 16 (App Router) | หน้าเว็บ + route handlers ใน `app/` |
| UI library | React 19 | `react`, `react-dom` |
| ภาษา | JavaScript (ส่วนใหญ่) + TypeScript 7 | หน้า `dashboard`, `projects`, `page` เป็น `.tsx`; type อยู่ใน `types/` |
| Styling | CSS (`app/globals.css`) | ไม่มี UI framework ภายนอกใน dependencies |
| Components | `components/ui`, `components/bid-prep`, `components/profile`, `AuthWaitDialog.tsx` | เช่น `TechStackComparisonCard` ในหน้า TOR |

หน้าหลัก: `/` , `/dashboard`, `/projects`, `/tors/[id]` (+ `/document`), `/bid-prep` (+ `/drafts/[id]`), `/analytics`, `/profile`, `/admin` (+ `/unlock`)

## 3. Backend / API

| ส่วน | เทคโนโลยี |
| --- | --- |
| Runtime | Node.js 22 (image `node:22-bookworm-slim`), ESM (`"type": "module"`) |
| API | Next.js Route Handlers (`app/api/**/route.js`) |
| กลุ่ม API | `auth`, `admin`, `analytics`, `bid-prep`, `ingestion`, `processing`, `scraping`, `notifications`, `projects`, `tors`, `profile(s)`, `health` |
| Contract | OpenAPI (`docs/api/openapi.yaml`), ตรวจ schema ด้วย Ajv (+ ajv-formats) |
| Middleware | `proxy.js` (security headers / CORS / origin checks), `lib/security-policy.js` |
| Rate limiting | `lib/rate-limit.js` (guest/user/bid-prep แยกโควตา) |

## 4. ฐานข้อมูล

| ส่วน | เทคโนโลยี |
| --- | --- |
| DB | MongoDB 7 (compose: replica set `rs0`) หรือ MongoDB Atlas |
| Driver / ODM | `mongodb` ^7, `mongoose` ^9 |
| Vector search | Atlas Vector Search (embeddings ของโครงการ, `npm run embed`) |
| Models (`models/`) | Project, Document, DocumentPage, DocumentSummary, ExtractionRun, VertexChunk, ProcessingJob, IngestionRun, AcquisitionAttempt, DiscoveryCandidate, FiscalBudgetAnalysis, ClassificationOverride, Keyword, BidPrepDraft, User, NotificationBatch, NotificationDelivery, AdminPipelineState, PipelineTriggerAudit |
| Migration / index scripts | `db:ensure-indexes`, `db:migrate-users`, `db:migrate-normalized`, `db:reconcile-normalized`, `db:cleanup-legacy`, `db:link-revisions` |

## 5. Data ingestion และ Scraping

| ส่วน | เทคโนโลยี |
| --- | --- |
| แหล่งข้อมูล | e-GP API (ต้องมี `EGP_API_KEY`), e-GP RSS รายหน่วยงาน (`lib/egp-rss*.js`), fallback ผ่านเบราว์เซอร์ |
| Browser automation | Puppeteer 25 + Chromium (Debian) ใน worker image |
| HTML parsing | cheerio |
| ไฟล์ ZIP | yauzl (อ่าน), yazl (เขียน/ทดสอบ), จำกัดขนาด/อัตราบีบอัดผ่าน `TOR_ZIP_*` |
| ตัวตั้งเวลา | `scripts/ingestion-scheduler.js` (06:00/12:00/18:00 Asia/Bangkok) และ GitHub Actions `ingestion-schedule.yml` |
| ความทนทาน | `acquisition-health`, scraper failure policy, `processing-recovery` |

## 6. Document processing, OCR และ AI

| ส่วน | เทคโนโลยี |
| --- | --- |
| ดึงข้อความ PDF | Poppler (`poppler-utils`) |
| OCR | Tesseract + `tesseract-ocr-tha` (ไทย + อังกฤษ), ฟอนต์ `fonts-thai-tlwg`; ปรับด้วย `OCR_DPI`, `OCR_FORCE`, `OCR_MAX_DIMENSION` |
| คิวงาน | `ProcessingJob` ใน MongoDB + `scripts/worker.js` (`--watch`), priority และ recovery |
| LLM หลัก | Vertex AI: Gemini 2.5 Flash (`VERTEX_MODEL`), auth ผ่าน `google-auth-library` |
| Embeddings | Vertex embedding model (`VERTEX_EMBEDDING_MODEL`) |
| LLM สำรอง | Ollama / agy bridge (`AI_FALLBACK_PROVIDER`, `OLLAMA_BASE_URL`) ใช้สำหรับ demo เท่านั้น; embeddings ไม่ fallback |
| งานที่ใช้ AI | สรุป TOR, ตรวจเงื่อนไขจำกัดการแข่งขัน, ดึงงบประมาณ/ปีงบ, ตารางประกาศ, จัดหมวด software, draft ข้อเสนอ, extract ผลงานที่ผ่านมา |
| Matching | `lib/matchingEngine.js` (เทียบทักษะ/โปรไฟล์บริษัทกับ TOR) |

## 7. Bid Preparation Assistant

- Checklist, draft editor, บันทึกร่าง (`BidPrepDraft`), ส่งออก DOCX (`lib/bid-prep/docx.js`)
- โปรไฟล์บริษัทและผลงานที่ผ่านมา, สร้าง proposal draft ด้วย Vertex (schema validation)
- ตรวจสิทธิ์แบบ owner-bound, rate limit แยกตามการกระทำ (read/write/draft/export/delete)
- ไม่ยื่นซองไปยัง e-GP

## 8. Authentication และ Security

| ส่วน | เทคโนโลยี |
| --- | --- |
| Password | scrypt (salted) |
| Token | JWT HS256 (`jsonwebtoken`, `jose`), ตรวจ expiration และบัญชีที่ถูก disable |
| OAuth | Google OAuth authorization-code flow |
| Authorization | Roles/scopes, admin gate (email allowlist, IP allowlist, access code hash), pipeline admin token |
| HTTP hardening | Security headers, exact-origin CORS, ปิด `X-Powered-By` |
| Audit | `auth-audit`, `PipelineTriggerAudit`, `admin-pipeline-audit` |
| SAST / DAST | Semgrep (`semgrep.yml`), OWASP ZAP (`zap-dast.yml`), `audit:dependencies` |
| เอกสารอ้างอิง | `docs/security/` (Threat model, ASVS checklist, RBAC spec) |

## 9. การแจ้งเตือน

- Email: Resend (`resend`) และ SMTP (`nodemailer`)
- Daily digest และ threshold notifications (`notify:digest`, `notify:retry`, `notify:test-smtp`)
- เก็บสถานะการส่งใน `NotificationBatch` / `NotificationDelivery`

## 10. Storage

| Backend | รายละเอียด |
| --- | --- |
| Local | volume `tor-storage` mount ที่ `/app/storage` (`TOR_STORAGE_DIR`) |
| Google Cloud Storage | `@google-cloud/storage`, ตั้งด้วย `TOR_STORAGE_BACKEND` และ `TOR_GCS_BUCKET` |

## 11. DevOps / CI-CD

| ส่วน | เทคโนโลยี |
| --- | --- |
| Container | Docker, Docker Compose (`Dockerfile` สำหรับ app แบบ multi-stage รันเป็น user `node`; `Dockerfile.worker` สำหรับ scraper/worker/scheduler); `docker-compose.atlas.yml` สำหรับ Atlas |
| CI/CD | GitHub Actions: `ci.yml`, `health-check.yml`, `ingestion-schedule.yml`, `semgrep.yml`, `summary.yml`, `sync-develop.yml`, `zap-dast.yml` |
| Config | `.env` (ดูตัวแปรทั้งหมดใน `.env.example`), `dotenv` |
| ผู้ให้บริการภายนอก | e-GP, MongoDB Atlas, Google Cloud (Vertex AI, GCS, OAuth), Resend/SMTP |

## 12. Testing

| ชนิด | เครื่องมือ |
| --- | --- |
| Unit / integration | Node test runner (`npm test`, `tests/unit`, `tests/integration`) |
| Component / TS | Vitest 5 (`npm run test:vitest`) |
| Security | `tests/security/` (เช่น bid-prep access, scopes/CORS/headers) |
| Stress / benchmark | `test:stress`, `benchmark:acquisition` |
| E2E / evidence | รายงานใน `docs/` และ `docs/evidence/` |

## 13. Dependencies (จาก `package.json`)

**Runtime:** `next` ^16.3, `react` / `react-dom` ^19.2, `mongodb` ^7.6, `mongoose` ^9.9, `puppeteer` ^25.9, `cheerio` ^1.2, `@google-cloud/storage` ^8, `google-auth-library` ^10, `jose` ^6, `jsonwebtoken` ^9, `nodemailer` ^10, `resend` ^6, `yauzl` ^3, `dotenv` ^16

**Dev:** `typescript` 7.0.2, `vitest` ^5, `@types/node`, `@types/react`, `ajv`, `ajv-formats`, `js-yaml`, `yazl`

## 14. โครงสร้างโฟลเดอร์

| โฟลเดอร์ | หน้าที่ |
| --- | --- |
| `app/` | หน้า Next.js และ API routes |
| `components/` | React components |
| `lib/` | business logic: pipeline, auth, e-GP clients, AI, bid-prep, analytics |
| `models/` | Mongoose schemas |
| `scripts/` | worker, scraper, scheduler, migration, backfill, ทดสอบ |
| `types/` | TypeScript types |
| `tests/` | unit / integration / security |
| `docs/` | เอกสารระบบ, security, test reports, diagrams |
| `skills/`, `tools/` | เครื่องมือช่วยงานของโครงการ |

## 15. หมายเหตุ

- หน้า UI ที่แสดง tech stack มีเฉพาะส่วนเปรียบเทียบในหน้า TOR (`app/tors/[id]/page.js`) ซึ่งเป็น tech stack ที่ดึงจากเอกสาร TOR ไม่ใช่ stack ของระบบนี้
- เวอร์ชันอ้างอิงจาก `package.json` ณ วันที่เขียนเอกสาร ตรวจเวอร์ชันจริงที่ lockfile
- ข้อมูลเชิงลึกเพิ่มเติม: [reference.md](reference.md), [pipeline.md](pipeline.md), [handover.md](handover.md)
