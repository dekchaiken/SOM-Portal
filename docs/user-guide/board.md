# Web Board — คู่มือการใช้งาน

**หน้า:** `board.html`
**บทบาทที่ใช้ได้:** ทุก role
**สิทธิ์เข้าถึง:** ทุกคนที่ login (feature toggle: `board`)

## ภาพรวม

Web Board เป็นบอร์ดโพสต์ (post/announcement) สำหรับทีม ใช้แจ้ง incident, ประกาศ, sharing knowledge หรือติดตามเคส. รองรับ:
- **Categories/Tabs** — จัดหมวดโพสต์ (config โดย admin)
- **Service Type / Sub Type** — Tag บริการที่โพสต์เกี่ยวข้อง
- **Status** — `open` / `in_progress` / `resolved`
- **Pin / Star / Comments** — pin โพสต์สำคัญ, star ส่วนตัว, คอมเมนต์ต่อกัน
- **Mentions (`@name`)** — แจ้งเตือนคนในทีมผ่าน @
- **Image upload** — วางรูป (paste) หรือแนบไฟล์
- **Edit history** — เก็บ history การแก้ไขทุกครั้ง

## ส่วนประกอบหลัก

### Header
- **Status filter** — dropdown กรองตาม `open` / `in_progress` / `resolved` / `all`
- **Search** — ค้นหาใน title/content ของโพสต์
- **+ New Post** — เปิด modal สร้างโพสต์ใหม่

### Board Tabs
- **All** — โพสต์ทั้งหมด (default)
- **Custom categories** — admin ตั้งไว้ (เช่น "Incident", "Change", "Announcement")
- **★ Starred** — โพสต์ที่คุณกด star ไว้เท่านั้น (ขวาสุด)

### New Posts Banner
- แถบสีส้มโผล่บนสุด "มีโพสต์ใหม่ X รายการ" — คลิกเพื่อ reload

### Post Card
แต่ละการ์ดโพสต์แสดง:
- Avatar + ชื่อผู้เขียน (คลิกไปหน้า profile ของเขา)
- Title + preview content
- Badges: category, service type, status
- 💬 จำนวน comment
- ⭐ Star (ส่วนตัว) / 📌 Pin (public — เฉพาะ lead/admin)
- ✎ Edit / ✕ Delete (เจ้าของโพสต์ + lead/admin)
- **โพสต์ที่ถูก pin** จะขึ้นบนสุดพร้อม border สีพิเศษ

## ขั้นตอนการใช้งาน

### สร้างโพสต์ใหม่
1. คลิก **+ New Post** ที่ header
2. เลือก **Board Category** (เช่น Incident / Announcement)
3. เลือก **Service Type** + **Sub Type**
   - ถ้าไม่มีในลิสต์ → คลิก "+ เพิ่มใหม่" → กรอกชื่อ → คลิก "เพิ่ม" (สร้าง service type ใหม่)
4. เลือก **Status**: `open` (default) / `in_progress` / `resolved`
   - Field นี้จะแสดงเฉพาะเมื่อเลือก category ที่มี status (เช่น Incident)
5. กรอก **Title** (สูงสุด 200 ตัวอักษร)
6. กรอก **Content**:
   - Markdown ใช้ได้: `**bold**`, `*italic*`, ``` `code` ```
   - `@ชื่อ` เพื่อ mention คน — dropdown จะโผล่ให้เลือก
   - `@allsm` หรือ `@all-<team>` = mention ทั้งทีม
   - **Paste รูป** จาก clipboard = upload อัตโนมัติ
   - **แนบไฟล์** = คลิก icon 📎 หรือลากไฟล์ลงในช่อง
7. คลิก **Create Post**

### แก้ไข / ลบโพสต์
- **เจ้าของโพสต์**: แก้ไข/ลบได้เอง
- **Lead / Admin / Dev**: แก้ไข/ลบได้ทุกโพสต์
- ปุ่ม ✎ Edit → เปิด modal เดิม (จะเก็บ history)
- ปุ่ม ✕ Delete → soft-delete ไปที่ Trash (admin กู้ได้)

### Pin โพสต์
- เฉพาะ **Lead** / **Admin** / **Dev** เท่านั้น
- คลิก 📌 → โพสต์ขึ้นบนสุด, ทุกคนเห็น
- คลิกอีกครั้งเพื่อ Unpin

### Star โพสต์ (ส่วนตัว)
- ทุกคนกดได้ ⭐ = bookmark ส่วนตัว
- ไปแท็บ **★ Starred** เพื่อดูรวม

### Comment
1. คลิกการ์ดโพสต์ → เปิด detail modal
2. เลื่อนลงมาส่วน Comments
3. พิมพ์ในช่องด้านล่าง (Markdown + @mention + paste image รองรับ)
4. คลิก **Send** หรือ **Ctrl+Enter**
5. คอมเมนต์ของตัวเอง → มีปุ่ม ✎ Edit / ✕ Delete

### ดู Edit History
1. เปิด detail modal
2. คลิก **▶ History (N)** ที่ด้านล่าง content
3. เห็น timeline การแก้ไข: ใคร แก้เมื่อไหร่ diff อะไร

## Tips & Shortcuts

- **Search แบบเร็ว** — พิมพ์ที่ search box, ผลลัพธ์ debounce ~300ms
- **Real-time updates** — Banner "มีโพสต์ใหม่" จะโผล่เมื่อมีคนโพสต์ระหว่างที่คุณเปิดหน้าอยู่
- **Mention คนทั้งทีม** — `@allsm` (ถ้าอยู่ทีม sm) — คนในทีมจะได้ noti
- **Paste รูปเร็ว** — Cmd+V/Ctrl+V ในช่อง content หรือ comment upload อัตโนมัติ

## Edge Cases / สิ่งที่ควรรู้

- **โพสต์หาย** — ถูก soft-delete ไปที่ Trash → แจ้ง admin กู้ที่ Admin → Trash
- **Category / Service Type ไม่มี** — Admin ตั้งได้ที่ Admin → Board Config หรือ Service Severity
- **Mention ไม่ทำงาน** — ต้องเลือกจาก dropdown (พิมพ์ @ แล้วเลือก) — พิมพ์ `@name` เฉย ๆ ไม่ trigger noti
- **รูปอัปโหลดล้มเหลว** — จำกัดขนาด/ประเภท config ที่ system-settings → ขนาดสูงสุด 5MB, ประเภท `.jpg/.png/.gif/.webp`
- **Status filter ไม่แสดง status** — ถ้า category ไม่ได้ enable status field, dropdown จะไม่โผล่ในโพสต์ใหม่
- **Pinned โพสต์เยอะเกิน** — แนะนำ pin ไม่เกิน 3-5 โพสต์เพื่อไม่ให้บอร์ดรก
- **Comment แก้ไข** — เก็บ `edited_at` แต่ไม่แสดง diff history

## ไฟล์ที่เกี่ยวข้อง

- **HTML:** `board.html`
- **API:** `/api/board`, `/api/board-comments`, `/api/board-config`, `/api/service-types`, `/api/stars`, `/api/upload`
