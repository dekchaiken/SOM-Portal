# Weekly Report — คู่มือการใช้งาน

**หน้า:** `weekly-report.html` (view), `weekly-report-form.html` (edit form), `presentation.html` (present mode)
**บทบาทที่ใช้ได้:** ทุก role (feature toggle: `weekly-report`)
**สิทธิ์:**
- **ดู view**: ทุกคน
- **แก้ form**: **Lead**, **Admin**, **Dev**
- **Present**: ทุกคน

## ภาพรวม

Weekly Report = รายงานสรุปงานประจำสัปดาห์ของทีม ประกอบด้วย 6 section:
1. **📢 Announcement** — ประกาศประจำสัปดาห์
2. **⚠️ Incidents** — incident ที่ SM detect
3. **📦 Batch** — batch event + pending issue
4. **🤝 Support** — MA support + Dev support
5. **🔔 Updates** — alert Grafana / handover / other
6. **🚀 Improvements** — improvement + project update

รองรับ **Sync จาก Jira** (auto-import ticket), **Analytics dashboard**, และ **Presentation mode** (ใช้ present ในที่ประชุม).

## หน้า View — `weekly-report.html`

### Week Selector (Header)
- **◀ / ▶** — เปลี่ยนสัปดาห์
- **Dropdown** — เลือกสัปดาห์เฉพาะ
- **📊 Analytics** — เปิดหน้า analytics ของ report
- **🎥 Present** — เข้า presentation mode

### Stats Cards (บนสุด)
- **Incidents / Batch / Support / Updates** — จำนวนแต่ละหมวด

### Section Cards
- **⚠️ Incidents** — ตาราง ticket incident
- **🔔 Updates** — alert & handover
- **🤝 Support** — MA / Dev
- **📦 Batch** — event / pending
- **🚀 Improvements** — improvement / project
- แต่ละ card คลิกได้ → เจาะดูรายละเอียด / กระโดดไป Jira ticket

## หน้า Form — `weekly-report-form.html`

### Layout
- ด้านซ้าย: sidebar tab (Announcement, Incidents, Batch, Support, Updates, Improvements)
- ด้านขวา: form ของ section ที่เลือก

### 📢 Announcement
- **Textarea** — ประกาศ (max 500 chars)
- **Expiry date** — วันหมดอายุประกาศ
- ปุ่ม **➕ เพิ่มประกาศ** → เพิ่มเข้า list
- **💾 บันทึกประกาศทั้งหมด**

### ⚠️ Incidents
- **🧪 Test Jira** — ทดสอบ connection Jira
- **🔄 Sync Jira** — ดึง incident จาก Jira อัตโนมัติ
- Form: **Ticket ID / URL / Title / Severity / Detection / Root Cause / Resolution**
- **Add Incident** → list ด้านล่าง
- แก้ / ลบ inline

### 📦 Batch
- **2 tab**: Batch & Event / Pending Issue
- Form: Title, URL, Description
- **Add Batch Item**

### 🤝 Support
- **🔄 Sync MA** — sync closed MA ticket จาก Jira
- **🔄 Sync Dev** — sync closed Dev support จาก Jira
- **2 tab**: MA / Support Dev
- Form: Ticket ID, URL, Owner, Category

### 🔔 Updates
- **3 tab**: Update Alert Grafana / Handover / Other
- Form: Ticket (optional), URL (optional), Description

### 🚀 Improvements
- **2 tab**: Improvement / Project Update
- Form: Title, Description, Owner, Status

## ขั้นตอนการใช้งาน

### ทำ Weekly Report ของสัปดาห์
1. เข้า `weekly-report-form.html`
2. เลือกสัปดาห์ที่ต้องการ (default = current week)
3. เข้าแต่ละ section แล้วกรอก/sync:
   - **Sync Jira** ก่อน — auto-import ticket ที่เกี่ยวข้อง
   - เพิ่มรายการที่ Jira ไม่ครอบคลุม manual
4. กด **บันทึก** ทุก section
5. ตรวจสอบใน view (`weekly-report.html`)

### Sync จาก Jira
- **Test Jira** ก่อน — ตรวจว่า Jira token ยัง valid
- **Sync Incidents** — ดึง ticket ที่มี label / project ตามที่ config
- **Sync MA / Dev** — ดึง closed ticket ในสัปดาห์นั้น
- Ticket ที่ sync แล้ว จะ merge ไม่ซ้ำ (dedupe by ticketId)

### Present ในที่ประชุม
1. เข้าหน้า view → คลิก **🎥 Present**
2. Presentation mode เต็มจอ — slide ทีละ section
3. ← / → เปลี่ยน slide
4. Esc = ออก

### Analytics
- คลิก **📊 Analytics** → เห็น trend หลายสัปดาห์
  - Incident count / severity
  - Batch failure rate
  - Support ticket volume
  - อื่น ๆ

## Tips

- **Current week status** — form จะแสดง badge "📝 Current Week" หรือ "🔒 Locked (past)"
- **Ticket clickable** — คลิก ticket ID → เปิด Jira ในแท็บใหม่
- **Bulk sync** — sync Jira ครั้งเดียวได้หลาย section
- **Presentation mode** — ตัวใหญ่ อ่านง่าย, เหมาะกับ TV/projector

## Edge Cases

- **Jira sync fail** — ตรวจ JIRA_TOKEN ใน .env / Admin → Jira Config
- **Ticket duplicate** — ระบบ dedupe by ticket_id, ไม่สร้างซ้ำ
- **สัปดาห์ที่ไม่มีข้อมูล** — ทุก card เป็น 0 / empty state
- **ปีข้าม** — dropdown สัปดาห์แสดงข้าม year boundary ด้วย
- **หายไปหลัง sync** — บาง ticket อาจถูก filter out ถ้า status ไม่ match

## ไฟล์ที่เกี่ยวข้อง

- **HTML:** `weekly-report.html`, `weekly-report-form.html`, `presentation.html`
- **JS:** `assets/js/weekly-report/`
- **API:** `/api/weekly-report`, `/api/jira`
