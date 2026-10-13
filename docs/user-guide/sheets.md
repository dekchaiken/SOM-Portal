# Team Docs (Sheets) — คู่มือการใช้งาน

**หน้า:** `sheets.html`
**บทบาทที่ใช้ได้:** ทุก role (feature toggle: `team-docs`)
**สิทธิ์เข้าถึง:**
- **อ่าน/เปิด**: ทุกคน
- **เพิ่ม/แก้ไข/ลบ**: **Lead**, **Admin**, **Dev** (ไม่รวม **User**)

## ภาพรวม

Team Docs เป็น **shortcut hub** สำหรับ Google Sheets / Google Docs / Excel ที่ทีมใช้ประจำ (Weekly Report, Roster, KPI Tracker ฯลฯ). เปิดใน viewer แบบ embed ในหน้าเดียวกัน ไม่ต้องจำ URL ยาว ๆ.

## ส่วนประกอบหลัก

### Header
- **ช่องค้นหา** — ค้นหาชื่อ/description ของเอกสาร
- **+ เพิ่มเอกสาร** — เปิด modal เพิ่มลิงก์ใหม่ (เฉพาะ lead/admin)

### Category Tabs
- **ทั้งหมด** (default) + tabs ตาม category ที่ตั้งไว้
- Category ใหม่จะสร้างเมื่อ save doc ที่มี category ที่ยังไม่มี

### Doc Cards (การ์ดเอกสาร)
แต่ละการ์ดแสดง:
- ไอคอนตาม type (📊 Sheets, 📄 Docs, 📈 Excel...)
- ชื่อเอกสาร + description
- Category tag
- ปุ่ม ✎ Edit / ✕ Delete (เฉพาะ lead/admin, hover เพื่อโผล่)
- คลิกการ์ดเพื่อเปิดใน viewer

## ขั้นตอนการใช้งาน

### เปิดเอกสาร
1. คลิกที่การ์ดเอกสาร
2. ระบบพาไปที่ `viewer.html?src=<embed_url>&title=<name>`
3. เอกสารจะ embed เต็มจอ ใช้งานได้เหมือนเปิดใน Google
4. คลิก back (←) ของ browser เพื่อกลับ

### เพิ่มเอกสารใหม่ (lead/admin เท่านั้น)
1. คลิก **+ เพิ่มเอกสาร**
2. กรอก:
   - **ชื่อ** (สูงสุด 120 ตัวอักษร) — เช่น "Weekly Report Q4"
   - **URL** — ลิงก์ Google Sheets/Docs (จะแปลงเป็น embed URL อัตโนมัติ)
   - **Type** — Sheets / Docs / Slides / Excel
   - **Category** — เลือกจากลิสต์เดิม หรือพิมพ์ใหม่
   - **Description** (สูงสุด 300 ตัวอักษร) — อธิบายว่าใช้ทำอะไร
3. คลิก **บันทึก**

### แก้ไข / ลบ
- Hover การ์ด → ปุ่ม ✎ / ✕ จะโผล่
- ✎ Edit → เปิด modal เดิม กรอกใหม่
- ✕ Delete → มี confirmation ก่อนลบจริง

## Tips

- **URL ที่รองรับ** — Google Sheets/Docs/Slides ทุก URL sharing (`docs.google.com/...`) จะถูกแปลง `edit?...` → `preview` อัตโนมัติเพื่อ embed
- **สิทธิ์ Google** — ผู้ใช้ต้อง login Google และมีสิทธิ์เข้าถึง sheet นั้น ๆ เอง (ระบบไม่ proxy)
- **Category ว่างเปล่า** — ถ้าไม่ระบุ category จะขึ้น tab "ไม่มีหมวด"

## Edge Cases

- **Viewer โหลดไม่ขึ้น** — ตรวจสิทธิ์ Google ของคุณ (อาจ share ไม่ถึง)
- **เอกสารเก่า / ไม่ update** — ให้ admin แก้ URL หรือลบทิ้ง
- **Feature ปิด** — ถ้า admin ปิด feature `team-docs`, เมนู "Team Docs" จะไม่โผล่ที่ sidebar

## ไฟล์ที่เกี่ยวข้อง

- **HTML:** `sheets.html`, `viewer.html`
- **API:** `/api/sheets`
