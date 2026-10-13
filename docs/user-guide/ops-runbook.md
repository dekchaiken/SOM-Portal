# Ops Runbook — คู่มือการใช้งาน

**หน้า:** `ops-runbook.html`
**บทบาทที่ใช้ได้:** ทุก role
**สิทธิ์:**
- **ดู**: ทุกคน
- **เพิ่ม/แก้/ลบ row**: **Lead**, **Admin**, **Dev**
- **จัดการ section (Admin only)**: **Admin**, **Dev**

## ภาพรวม

Ops Runbook = **ข้อมูล runbook สำหรับปฏิบัติงาน** — เก็บ operational data ที่ต้องใช้บ่อย ๆ ตอน incident หรือ maintenance:
- **Block Biz Rule** — service ที่ block business rule
- **Gateway** — API gateway configs
- **Restart** — วิธี restart service ต่าง ๆ
- **Network** — network diagram / troubleshoot

Data model = **Sections** (tab) → **Columns** (schema) → **Rows** (data)

## ส่วนประกอบหลัก

### Header
- **📖 Ops Runbook**
- **Sub**: "ข้อมูล Runbook สำหรับปฏิบัติงาน — Block Biz Rule, Gateway, Restart, Network"
- Topbar actions (admin: อาจมีปุ่มจัดการ section)

### Section Tabs
- แต่ละ tab = 1 section (Admin config)
- คลิกสลับ

### Section Panel
- Table แสดง row ตาม column ที่ตั้ง
- **+ เพิ่มข้อมูล** button (lead/admin)
- แต่ละ row: แก้ ✎ / ลบ 🗑 (lead/admin)

### Add / Edit Row Modal
- Form dynamic ตาม column ของ section
- Field types:
  - **Text** — input text
  - **URL** — input URL (auto-link)
  - **Select** — dropdown (options ที่ตั้ง)
- **บันทึก** / Cancel

### Delete Confirmation Modal
- Confirm ก่อนลบ (สีแดง)

## ขั้นตอนการใช้งาน

### หา runbook สำหรับ incident
1. เปิด Ops Runbook
2. เลือก section ที่เกี่ยว (เช่น "Restart" ถ้าต้อง restart service)
3. หา row ของ service นั้น
4. อ่านคอลัมน์: steps, URL, contact, etc.

### เพิ่มข้อมูล Runbook (Lead/Admin)
1. เลือก section
2. คลิก **+ เพิ่มข้อมูลแรก** (empty) หรือ **+ เพิ่มข้อมูล**
3. กรอกทุก field (required เห็นชัด)
4. **บันทึก**

### แก้ไข Row
1. คลิก ✎ (edit) ของ row
2. Modal เดิม แต่ pre-fill ข้อมูล
3. แก้ → **บันทึก**

### ลบ Row
1. คลิก 🗑 → modal confirm
2. Confirm → ลบถาวร (soft-delete หรือ hard ตาม config)

### View Tracking
- ระบบ track ว่าใครเปิดดู runbook ไหน (`trackOpsRunbookView`)
- ใช้ analytics ว่า runbook ไหน active

## Tips

- **URL columns** — auto render clickable link
- **Select columns** — แน่ใจว่ามี option ถูก (ต้อง admin ตั้งไว้)
- **Search** — Ctrl+F ใน browser
- **Copy row** — เลือกข้อความ table → copy
- **Multi-team** — runbook แต่ละทีมแยกกัน (multi-team data path)

## Edge Cases

- **Section ว่าง** — Admin ต้อง config section + column ที่ Admin → Ops Runbook
- **ลบ row ไม่ได้** — เช็ค role (ต้อง lead/admin)
- **Column เพิ่มใหม่** — row เก่าจะมี field ว่าง (empty string)
- **Section reorder** — admin drag ที่ Admin
- **URL invalid** — ระบบยังบันทึกได้ แต่ link ไม่ทำงาน

## ไฟล์ที่เกี่ยวข้อง

- **HTML:** `ops-runbook.html`
- **API:** `/api/ops-runbook` (list, createRow, updateRow, deleteRow)
- **Admin:** `admin/ops-runbook.html`
