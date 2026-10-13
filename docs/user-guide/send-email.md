# SMC Ticket (Send Email) — คู่มือการใช้งาน

**หน้า:** `send-email.html`
**บทบาทที่ใช้ได้:** ทุก role (feature toggle: `jira-templates`)
**สิทธิ์:**
- **ส่งเมลจาก case**: ทุกคน
- **แก้ status ticket**: ทุกคน (ถ้าเป็น assignee หรือ owner)
- **สร้าง Jira ticket ใหม่**: ทุกคน (ผ่าน template)

## ภาพรวม

หน้า SMC Ticket = ส่วนกลางที่ **รวม Jira SMC ticket** + **เครื่องมือส่งอีเมล** จาก case ที่เจอ:
- แสดงรายการ Jira case ที่เปิดอยู่
- คลิก case → เปิด email composer พร้อม subject/template auto-fill
- เปลี่ยน status ticket ได้จากหน้านี้เลย
- เปิด detail modal ดูรายละเอียด ticket แบบเต็ม

## ส่วนประกอบหลัก

### Header
- **📋 SMC Cases** — title + subtitle บอกจำนวน case
- **📅 Date picker** — filter case ตามวันสร้าง
- **↺ Refresh** — reload
- **🔍 Search** — ค้นหา key (SMC-xxxx) หรือ summary
- **+ New** (topbar) — เปิด modal สร้าง Jira ticket ใหม่ (จาก template)

### Cases List (ด้านซ้าย)
- รายการ ticket พร้อม key, summary, status badge, assignee
- คลิกแถวเพื่อเปิด **email form** ด้านขวา
- คลิก key → เปิด **detail modal** ดูข้อมูลเต็ม

### Email Form (ด้านขวา - slide in)
เมื่อเลือก case:
- **← กลับ** — ปิด form
- **Case key + summary** — บนสุด
- **To** / **CC** — chip input, พิมพ์ email พร้อม autocomplete จาก contact
- **Sub Type** — dropdown (Incident / Change / Support ฯลฯ)
- **Service** — dropdown (ถ้า sub type ต้องใช้)
- **Subject** — auto-fill จาก case แต่แก้ได้
- **Body** — Rich text editor:
  - Font size selector
  - Bold / Italic / Underline / Strike
  - Bullet / Numbered list
  - 🖼 Insert image
  - ✕ Clear formatting
- **📨 ส่ง Email**

### Contact Autocomplete Popover
- พิมพ์ใน To/CC → popover แสดงรายชื่อ contact
- Search bar ในตัว popover

### Confirm Dialog
- ก่อนส่ง / เปลี่ยน status → มี confirm dialog

### Status Change Modal
- คลิก status badge → เปลี่ยน status
- ใส่ comment ถ้าต้อง

### Detail Modal
- คลิก ticket key → เปิด modal เต็มจอ:
  - Summary, description, priority
  - Comments log (ทั้งจาก Jira)
  - Attachments
  - History
  - ปุ่มเปลี่ยน status

## ขั้นตอนการใช้งาน

### ส่ง Email จาก Jira case
1. เลือก **📅 วันที่** case (default = today)
2. คลิก case ใน list → email form slide in
3. ระบุ **To** (chip) + **CC**
4. เลือก **Sub Type** → **Service** (ถ้ามี)
5. ปรับ **Subject** ถ้าจำเป็น
6. พิมพ์ body + format ตามต้องการ
7. คลิก **📨 ส่ง Email**
8. Confirm → ระบบส่ง SMTP + log activity

### สร้าง Jira Ticket ใหม่ (จาก template)
1. คลิก **+ New** (topbar)
2. เลือก **Template** — จากรายการที่ admin ทำไว้
3. Field ถูก pre-fill ตาม template (custom fields, priority, ฯลฯ)
4. กรอกส่วนที่ต้อง — Title, Description, Assignee
5. **Create** — Jira ticket ถูกสร้างใน SMC project

### เปลี่ยน Status ของ Ticket
1. คลิก status badge บนแถว case (หรือใน detail modal)
2. เลือก status ใหม่ (Open → In Progress → Resolved)
3. เพิ่ม comment (บาง transition บังคับ)
4. คลิก **🔄 เปลี่ยนสถานะ**

### ดู Detail ของ Ticket
1. คลิก key (SMC-xxxx) ใน list
2. Modal เปิด — ดู summary/description/comments/history
3. Comments log จาก Jira sync live
4. ปิด: ✕ หรือ click backdrop

## Tips

- **Contact จำได้** — ระบบเก็บ contact ที่เคยส่งไว้ ใช้ autocomplete ครั้งถัดไป
- **Ctrl+B/I/U** — shortcut ใน editor
- **Paste รูป** — วางรูปในเบา body ได้เลย (อัปโหลดอัตโนมัติ)
- **Template ที่ใช้บ่อย** — admin ทำ template ที่ Admin → Jira Templates
- **Sub Type / Service dropdown ว่าง** — admin config ใน Admin → Jira Config

## Edge Cases

- **ส่งเมลไม่สำเร็จ** — ตรวจ SMTP config ที่ Admin → Mail Config
- **Contact autocomplete ไม่ suggest** — ยังไม่เคยใช้ contact นั้น หรือ history clear
- **Status change fail** — บาง transition Jira กำหนด condition (assignee/comment) — ตรวจ error
- **Detail modal ว่าง** — Jira token expired หรือไม่มีสิทธิ์เห็น ticket นั้น
- **Ticket ไม่โผล่** — ตรวจ date filter (default = วันนี้)
- **Attachment upload ช้า** — ไฟล์ใหญ่ → บีบก่อน

## ไฟล์ที่เกี่ยวข้อง

- **HTML:** `send-email.html`, `jira-templates.html`
- **API:** `/api/jira`, `/api/mail`, `/api/templates`, `/api/jira-config`
- **Admin:** Admin → Jira Config, Jira Templates, Mail Config
