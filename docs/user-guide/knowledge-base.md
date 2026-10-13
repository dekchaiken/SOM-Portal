# Knowledge Base — คู่มือการใช้งาน

**หน้า:** `knowledge-base.html`
**บทบาทที่ใช้ได้:** ทุก role
**สิทธิ์:**
- **ดู**: ทุกคน
- **เพิ่ม/แก้ entry**: ทุกคน (บาง config อาจจำกัด)
- **เพิ่ม category / จัดการ field**: **Lead**, **Admin**, **Dev**

## ภาพรวม

Knowledge Base = **คลังความรู้ทีม** จัดเป็น **Categories** (เช่น "Database Management", "Network Troubleshooting") — แต่ละ category มี **custom fields** ที่ admin ตั้งเอง (schema-flexible).

## ส่วนประกอบหลัก

### KB Tabs
- Tab แต่ละอันคือ category
- คลิกสลับ

### Category View
- List entry ในหมวดนั้น (แสดงเป็น table หรือ card ตาม field ที่ตั้ง)
- ปุ่ม **+ Add Entry**
- Admin: **⚙ Manage Fields** ของ category

### Modals

#### Add Entry Modal
- Form dynamic ตาม field ที่ category ตั้งไว้
- Field type: text / url / select / etc.
- Save

#### Add Category Modal (Admin)
- **Category Name** — เช่น "Database Management"
- **Fields list** — schema
- **+ Add Field**

#### Add Field Modal
- **Field Name** — เช่น "Priority"
- **Field Type**: Text / URL / Select / Number / Date
- **Options** (สำหรับ Select) — comma-separated
- **Required checkbox**

#### Manage Fields Modal
- List field ปัจจุบันของ category
- **+ Add Field**
- ลำดับ / delete

## ขั้นตอนการใช้งาน

### หา / อ่าน Entry
1. เข้า Knowledge Base
2. คลิก tab category ที่ต้องการ
3. ดู list entry — table/card
4. คลิก entry → รายละเอียด (บาง field แสดง link, description)

### เพิ่ม Entry ใหม่
1. เลือก category
2. คลิก **+ Add Entry**
3. Form modal โผล่ (field ตาม schema)
4. กรอกข้อมูล
5. **Save**

### สร้าง Category ใหม่ (Admin)
1. คลิก **+ Add Category**
2. ตั้งชื่อ + เพิ่ม field ตามต้องการ (drag order)
3. Save
4. Tab ใหม่โผล่ + พร้อมรับ entry

### จัดการ Field (Admin)
1. เข้า category → **⚙ Manage Fields**
2. เพิ่ม/ลบ/reorder field
3. Save

## Tips

- **Schema-flexible** — แต่ละ category มี field ไม่เหมือนกัน
- **Search** — Ctrl+F ใน browser (ไม่มี search bar dedicated)
- **URL field** — auto-render เป็น link clickable
- **Select field** — กำหนด option ล่วงหน้า
- **Multi-team** — KB ของแต่ละทีมแยกกัน

## Edge Cases

- **Change field type** — จะไม่ลบข้อมูลเก่า แต่ format อาจแตก
- **Delete category** — entry ทั้งหมดจะหาย (มี confirmation)
- **Required field** — form จะ block submit ถ้าไม่กรอก
- **KB ว่าง** — ยังไม่มี category → admin สร้างก่อน

## ไฟล์ที่เกี่ยวข้อง

- **HTML:** `knowledge-base.html`
- **JS:** `assets/js/knowledge-base.js`
- **API:** `/api/knowledge-base`
- **Admin:** `admin/knowledge-base.html`
