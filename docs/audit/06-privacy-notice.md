# Privacy notice (DRAFT for legal review)

Draft privacy notice. Company-data deletion traces to BidPrep FR-4.7.2. See [traceability.md](../traceability.md).

> **Status: draft.** It describes what the system does today, taken from the code and documents. It is not legal advice. Before publishing, a person responsible for the project must fill the **[fill in]** fields and have the text reviewed against the Personal Data Protection Act B.E. 2562 (PDPA). Publish it in the application (footer link and at registration) in Thai and English.

---

## ภาษาไทย

### 1. ผู้ควบคุมข้อมูลส่วนบุคคล
**[ระบุชื่อองค์กรหรือผู้รับผิดชอบระบบ MoneyTamNgan]** ที่อยู่ **[ระบุ]** อีเมลติดต่อ **[ระบุ]** เจ้าหน้าที่คุ้มครองข้อมูลส่วนบุคคล (ถ้ามี) **[ระบุ]**

### 2. ข้อมูลที่เราเก็บ
| ประเภท | รายละเอียด | ได้มาจาก |
|---|---|---|
| ข้อมูลบัญชี | อีเมล, ชื่อ, ชื่อผู้ใช้ (ถ้ามี), รูปโปรไฟล์และรหัสบัญชี Google (เมื่อสมัครผ่าน Google), รหัสผ่านที่เข้ารหัสแบบทางเดียว (เราไม่เก็บรหัสผ่านจริง) | ท่านกรอก หรือ Google |
| ข้อมูลบริษัทสำหรับการเตรียมเอกสารเสนอราคา | ชื่อบริษัท, เลขทะเบียน, ที่อยู่, ผู้มีอำนาจลงนาม, ทุนจดทะเบียน, ผลงานที่ผ่านมา, ใบรับรอง, ความสามารถในการรับงาน | ท่านกรอก |
| ร่างข้อเสนอและผลการตรวจสอบคุณสมบัติ | เนื้อหาร่างที่ท่านสร้างและแก้ไข, สถานะรายการตรวจสอบที่ท่านยืนยัน | ท่านสร้าง |
| การตั้งค่าการแจ้งเตือน | เปิดหรือปิดอีเมลแจ้งเตือน, เกณฑ์คะแนนความเหมาะสม, ความถี่ | ท่านเลือก |
| ข้อมูลทางเทคนิค | หมายเลข IP, เวลาและผลของการเข้าสู่ระบบและการเรียกใช้งานที่เกี่ยวกับความปลอดภัย, คุกกี้เซสชัน | ระบบบันทึกอัตโนมัติ |

เราไม่เก็บข้อมูลอ่อนไหวตามความหมายของ PDPA โดยเจตนา และไม่มีการอัปโหลดไฟล์จากผู้ใช้ ข้อมูลโครงการจัดซื้อจัดจ้างและเอกสาร TOR เป็นข้อมูลสาธารณะจากระบบ e-GP

### 3. วัตถุประสงค์และฐานทางกฎหมาย
| วัตถุประสงค์ | ฐานทางกฎหมาย |
|---|---|
| สร้างและดูแลบัญชี, เข้าสู่ระบบ | สัญญา / การให้บริการตามที่ท่านร้องขอ |
| ตรวจสอบคุณสมบัติเทียบกับ TOR และสร้างร่างข้อเสนอ | สัญญา / การให้บริการตามที่ท่านร้องขอ |
| คำนวณคะแนนความเหมาะสมและส่งอีเมลแจ้งเตือน | ความยินยอม (ท่านเปิดเอง และปิดได้ตลอดเวลา) |
| รักษาความปลอดภัย ป้องกันการใช้งานในทางที่ผิด บันทึกการตรวจสอบ | ประโยชน์โดยชอบด้วยกฎหมาย |
| ปฏิบัติตามกฎหมาย | หน้าที่ตามกฎหมาย |

### 4. การเปิดเผยข้อมูลและผู้ประมวลผล
| ผู้รับ | เพื่ออะไร | ข้อมูล |
|---|---|---|
| MongoDB Atlas | จัดเก็บฐานข้อมูล | ข้อมูลทั้งหมดในระบบ |
| Google (OAuth) | เข้าสู่ระบบด้วย Google | อีเมลและโปรไฟล์ที่ท่านอนุญาต |
| Resend / ผู้ให้บริการ SMTP | ส่งอีเมลแจ้งเตือน | อีเมลผู้รับและเนื้อหาแจ้งเตือน |
| ผู้ให้บริการ AI (Google Vertex AI หรือโมเดลในเครื่องของเรา) | สร้างร่างข้อเสนอ | ข้อความ TOR (สาธารณะ) และข้อมูลบริษัทของท่านที่เกี่ยวข้องกับร่างนั้น เมื่อใช้โมเดลในเครื่อง ข้อมูลไม่ออกนอกเครื่อง |

เราไม่ขายข้อมูลและไม่ใช้ข้อมูลของท่านเพื่อการโฆษณา ผู้ให้บริการข้างต้นบางรายอาจประมวลผลนอกประเทศไทย เราใช้ผู้ให้บริการที่มีมาตรการรักษาความปลอดภัยที่เหมาะสม **[ระบุภูมิภาคของ Atlas และ GCP ที่ใช้จริง]**

### 5. ระยะเวลาเก็บรักษา
- ข้อมูลบัญชี ข้อมูลบริษัท และร่างข้อเสนอ: เก็บจนกว่าท่านจะลบ (ไม่มีการหมดอายุอัตโนมัติ)
- บันทึกการตรวจสอบการใช้งานระบบของผู้ดูแล: **[ระบุ]** (ปัจจุบันยังไม่ได้กำหนดระยะเวลา)
- บันทึกเทคนิคการดึงข้อมูล (ไม่ใช่ข้อมูลส่วนบุคคล): 90 วัน

### 6. สิทธิของท่าน
ท่านมีสิทธิขอเข้าถึงและขอสำเนา ขอแก้ไขให้ถูกต้อง ขอให้ลบหรือทำให้ไม่สามารถระบุตัวตนได้ คัดค้านหรือจำกัดการประมวลผล ขอให้โอนย้ายข้อมูล และเพิกถอนความยินยอมได้ทุกเมื่อ โดยไม่กระทบการประมวลผลก่อนหน้านั้น
- **ลบร่างรายฉบับ:** ใช้ปุ่ม "ลบร่างนี้" ในหน้าแก้ไขร่าง
- **ลบข้อมูลบริษัทและร่างทั้งหมด โดยคงบัญชีไว้:** ใช้ปุ่ม "ลบข้อมูลบริษัท" ในหน้าโปรไฟล์
- **ลบบัญชีและข้อมูลทั้งหมด:** ใช้ปุ่ม "ลบบัญชีผู้ใช้" ในหน้าโปรไฟล์ (ทดสอบแล้วใน [F04](../testing/test-sheet.md))
- **สิทธิอื่น:** ติดต่อ **[อีเมล]** เราจะตอบภายใน 30 วัน
หากเห็นว่าเราไม่ปฏิบัติตามกฎหมาย ท่านมีสิทธิร้องเรียนต่อสำนักงานคณะกรรมการคุ้มครองข้อมูลส่วนบุคคล (สคส.)

### 7. คุกกี้
เราใช้คุกกี้เซสชันเพียงตัวเดียวที่จำเป็นต่อการเข้าสู่ระบบ (HttpOnly, SameSite=Lax, อายุ 24 ชั่วโมง) ไม่ใช้คุกกี้โฆษณาหรือเครื่องมือติดตามพฤติกรรมจากบุคคลที่สาม

### 8. การรักษาความปลอดภัย
รหัสผ่านเก็บแบบแฮชด้วย scrypt, การเข้าถึงข้อมูลบริษัทและร่างจำกัดเฉพาะเจ้าของ, การจำกัดอัตราการเรียกใช้งาน, หัวข้อความปลอดภัยของเว็บ, การควบคุมสิทธิ์ตามบทบาท และการตรวจสอบช่องโหว่อย่างสม่ำเสมอ ระบบ AI สร้างได้เพียงร่าง ท่านต้องตรวจสอบก่อนใช้ และระบบไม่ยื่นเอกสารแทนท่านใน e-GP
หากเกิดเหตุละเมิดข้อมูลส่วนบุคคล เราจะดำเนินการตามขั้นตอนใน[แผนรับมือเหตุการณ์](05-incident-response-runbook.md) และแจ้งท่านและหน่วยงานที่เกี่ยวข้องตามที่กฎหมายกำหนด

### 9. เด็ก
บริการนี้สำหรับผู้ประกอบการและผู้ที่บรรลุนิติภาวะ ไม่ได้มุ่งเก็บข้อมูลของผู้เยาว์

### 10. การเปลี่ยนแปลงประกาศนี้
เราจะแสดงวันที่ปรับปรุงล่าสุดและแจ้งให้ทราบเมื่อมีการเปลี่ยนแปลงที่สำคัญ ปรับปรุงล่าสุด: **[ระบุวันที่]**

---

## English

### 1. Data controller
**[name of the organisation or person responsible for MoneyTamNgan]**, address **[fill in]**, contact **[email]**, data protection officer (if any) **[fill in]**.

### 2. What we collect
| Category | Details | Source |
|---|---|---|
| Account | Email, name, username (optional), Google profile picture and Google account id (if you sign in with Google), a one-way password hash (we never store your password) | You, or Google |
| Company details for bid preparation | Company name, registration number, address, authorised signatory, registered capital, past projects, certifications, project capacity | You |
| Proposal drafts and checklist | Drafts you create and edit, checklist items you confirm | You |
| Notification settings | Email on/off, match-score threshold, frequency | You |
| Technical data | IP address, time and result of sign-in and security-relevant requests, the session cookie | Collected automatically |

We do not intentionally collect sensitive data as defined by the PDPA, and users cannot upload files. Procurement project data and TOR documents are public data from e-GP.

### 3. Purposes and legal bases
| Purpose | Legal basis |
|---|---|
| Create and run your account, sign you in | Contract / providing the service you ask for |
| Check qualifications against a TOR and generate a draft | Contract / providing the service you ask for |
| Compute match scores and send notification emails | Consent (you switch it on and can switch it off at any time) |
| Security, abuse prevention, audit records | Legitimate interests |
| Comply with law | Legal obligation |

### 4. Who receives data
| Recipient | Purpose | Data |
|---|---|---|
| MongoDB Atlas | Database hosting | All data in the system |
| Google (OAuth) | Sign-in with Google | Email and profile you allow |
| Resend / SMTP provider | Notification emails | Recipient address and notification content |
| AI provider (Google Vertex AI, or a model running on our own machine) | Generating drafts | TOR text (public) and the part of your company details used in that draft. With the local model, data does not leave the machine |

We do not sell data or use it for advertising. Some providers may process data outside Thailand; we use providers with appropriate security measures. **[state the Atlas and GCP regions actually used]**

### 5. Retention
- Account, company details and drafts: kept until you delete them (no automatic expiry).
- Admin audit records of system actions: **[fill in]** (no period is set today).
- Technical acquisition logs (not personal data): 90 days.

### 6. Your rights
You may ask for access and a copy, correction, erasure or anonymisation, to object to or restrict processing, data portability, and withdraw consent at any time without affecting earlier processing.
- **Delete one draft:** use the "delete this draft" button in the draft editor.
- **Delete your company details and drafts but keep the account:** use the "ลบข้อมูลบริษัท" button on the profile page.
- **Delete your account and all data:** use the "ลบบัญชีผู้ใช้" button on the profile page (both tested in flow F04 of the [test sheet](../testing/test-sheet.md)).
- **Other rights:** contact **[email]**; we reply within 30 days.
If you believe we do not comply with the law you may complain to the Personal Data Protection Committee (PDPC) of Thailand.

### 7. Cookies
One session cookie, strictly necessary for sign-in (HttpOnly, SameSite=Lax, 24 hours). No advertising cookies or third-party tracking.

### 8. Security
Passwords are hashed with scrypt; company data and drafts are readable only by their owner; rate limiting, web security headers, role-based access and regular vulnerability checks are in place. The AI only produces drafts; you must review them, and the system never submits anything to e-GP for you. If a personal-data breach occurs we follow the [incident response runbook](05-incident-response-runbook.md) and inform you and the authorities as the law requires.

### 9. Children
The service is for businesses and adults and is not aimed at collecting minors' data.

### 10. Changes
We show the date of the latest update and tell you about material changes. Last updated: **[fill in]**.

---

## Notes for the team (delete before publishing)
1. **Fill every [fill in]** and have the text reviewed by someone qualified for the PDPA. In particular: the controller identity, retention of audit records, regions of Atlas and GCP, and the contact process (30-day reply is our proposal).
2. Deletion is self-service on the profile page (verified by test F04); only requests for access, correction, portability and objection go through the contact email.
3. Put the notice in the application: link in the footer and a link next to the registration form. Today there is none.
4. Facts above are taken from `models/User.js`, `lib/auth.js`, `docs/API_VALIDATION.md` (deletion), `docs/bid-prep-decisions.md` (retention) and `docs/handover.md` (providers). Recheck them if the code changes.
5. "No advertising or tracking cookies" is based on the code reviewed; confirm no analytics script is added to the pages.
6. Admin audit records currently have no expiry; decide a period and, if needed, add a TTL index.
