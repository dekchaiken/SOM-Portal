# Team Inbox — คู่มือการใช้งาน

**หน้า:** `inbox.html`
**บทบาทที่ใช้ได้:** ทุก role (feature toggle: `inbox`)

## ภาพรวม

Team Inbox = กล่อง email แชร์ของทีม (shared mailbox) เชื่อม **IMAP/SMTP** ผ่าน `mail-config`. รองรับ:
- Folders (Inbox / Sent / Archive / Trash / custom)
- Filter: All / Unread / Starred
- Reply / Reply All / Forward
- Star, Archive, Delete
- Search
- Compose ใหม่ / Reply พร้อม editor rich text

Sidebar layout: **Folder list (ซ้าย)** | **Email list (กลาง)** | **Reader (ขวา)**

## ส่วนประกอบหลัก

### Sidebar (ซ้าย)
- **✏️ Compose** — เขียนเมลใหม่
- **Folders** — ทุก folder ของ mailbox (คลิกเพื่อสลับ)

### Middle Column — Email List
- **Filter buttons**: ทั้งหมด / ยังไม่อ่าน / ⭐ starred
- **↻ Refresh**
- **Search** — ค้นในหัวข้อ / from / body
- **Email rows**:
  - Checkbox เลือก
  - ⭐ Star toggle
  - From, subject, snippet
  - Timestamp
  - Quick actions: 📁 Archive / 🗑 Delete
- **Load more** — pagination

### Right Column — Reader Pane

เมื่อยังไม่เลือกเมล: empty state "เลือกเมลเพื่ออ่าน"

เมื่อเปิดเมล:
- **Subject** (bar บน)
- **Actions**:
  - ↩ **Reply**
  - ↩↩ **Reply All**
  - ↪ **Forward**
  - ☆ **Star**
  - ✓ **Mark** (as read/unread)
  - 📁 **Archive**
  - 🗑 **Delete**
- **Meta**: จาก / ถึง / สำเนา / เมื่อ
- **Body** — HTML rendering
- **Attachments** — list ไฟล์แนบ (คลิก download)

### Compose Overlay
- **ถึง (To)** / **สำเนา (CC)** — chip input, autocomplete
- **หัวข้อ**
- **Body** — Rich text editor (contenteditable)
- **📤 ส่ง**
- **Status** — แสดง "กำลังส่ง..." / "ส่งสำเร็จ"

## ขั้นตอนการใช้งาน

### อ่านเมล
1. เลือก folder (Inbox default)
2. คลิกแถวเมล
3. เนื้อหาโผล่ใน reader ทางขวา
4. เมลถูก mark read อัตโนมัติ

### ตอบเมล
1. เปิดเมล
2. คลิก **↩ Reply** (หรือ Reply All)
3. Compose modal โผล่ พร้อม To/subject/quoted body pre-fill
4. พิมพ์ตอบ
5. คลิก **📤 ส่ง**

### Forward
1. เปิดเมล → **↪ Forward**
2. Compose modal — subject มี "Fw:", body มี original
3. เติม To → ส่ง

### Compose ใหม่
1. คลิก **✏️ Compose**
2. กรอก To (พิมพ์ → autocomplete)
3. หัวข้อ + body
4. **📤 ส่ง**

### Bulk Actions
1. Tick checkbox หลายเมลใน list
2. Toolbar โผล่ → Archive / Delete / Mark
3. Confirm

### Star / Archive / Delete
- **⭐ Star** — bookmark ส่วนตัว, filter "Starred" เพื่อดู
- **📁 Archive** — ย้ายไป folder Archive (ไม่ลบ)
- **🗑 Delete** — ย้ายไป Trash

## Tips

- **Auto-refresh** — background poll ทุก N วินาที (config ใน system-settings)
- **Search** — ค้นทั้ง header + body (server-side)
- **Paste image** — วางรูปใน compose body ได้เลย
- **Multiple emails ใน To** — คั่นด้วย comma หรือ newline
- **Autocomplete** — จำ contact จากเมลที่เคยส่ง

## Edge Cases

- **Mailbox ว่าง** — folder ยังไม่ตั้งค่า/sync fail → ตรวจ Admin → Mail Config (IMAP)
- **ส่งไม่ออก** — SMTP config ผิด → Admin → Mail Config → Test connection
- **Body ไม่โผล่** — บาง email มี MIME multipart ผิด → download raw
- **Attachment ใหญ่** — limit 25MB per email (SMTP default)
- **Reply แล้วผู้รับตอบมา** — เข้ามาใน Inbox ปกติ (thread ยังไม่ group ในเวอร์ชันปัจจุบัน)
- **HTML ในเมลเสีย** — sanitize อาจตัดบางแท็ก (ไม่แสดง iframe/script)

## ไฟล์ที่เกี่ยวข้อง

- **HTML:** `inbox.html`
- **API:** `/api/mail`
- **Admin:** Admin → Mail Config, Mail Logs
