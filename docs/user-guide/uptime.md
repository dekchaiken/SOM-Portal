# Uptime Monitor — คู่มือการใช้งาน

**หน้า:** `uptime.html`
**บทบาทที่ใช้ได้:** ทุก role (feature toggle: `uptime`)
**สิทธิ์:**
- **ดู**: ทุกคน
- **เพิ่ม/ลบ monitor**: **Admin**, **Dev** (ปุ่ม `+ Monitor` โผล่เฉพาะ admin)
- **Config n8n push**: admin เท่านั้น

## ภาพรวม

Uptime Monitor = ตรวจสอบสถานะ URL / service ว่า up หรือ down. รองรับ 2 mode:
1. **HTTP check** — server ping URL ปกติ (จาก portal)
2. **n8n push** — external n8n workflow ยิง status มาผ่าน push URL (สำหรับ service ภายในที่ portal เข้าไม่ถึงตรง)

แสดงเป็น **grid ของการ์ด** — สีเขียว (up) / แดง (down) พร้อม uptime % รอบ 1h / 24h / 7d.

## ส่วนประกอบหลัก

### Header
- **Live badge** — auto-refresh indicator
- **↺ Refresh** — reload manual
- **⚙ n8n Config** — Admin (เปิด modal push URL/key)
- **+ Monitor** — Admin (เพิ่ม URL ใหม่)

### Uptime Grid
- การ์ดแต่ละ monitor:
  - **ชื่อ** monitor
  - **Status dot** สี + text ("ระบบทำงานปกติ" / "ระบบขัดข้อง!" / "กำลังตรวจสอบ...")
  - **URL** (แสดงย่อ)
  - **Uptime %**:
    - 1h — ชั่วโมงล่าสุด
    - 24h — 24 ชั่วโมง
    - 7d — 7 วัน
  - **🗑 Delete** (admin only)

### Empty State
- 📡 "ยังไม่มี URL ที่ Monitor" (เมื่อไม่มี monitor)

### Modals
1. **Add Monitor Modal**
   - **ชื่อ Monitor** (max 60)
   - **URL** (https://...)
   - เพิ่ม / ยกเลิก
2. **n8n Config Modal**
   - **Push URL** (readonly) — endpoint สำหรับ n8n ส่ง status
   - **Push Key** — auth token (สามารถ regen ↺)
   - Instructions ตั้ง n8n

## ขั้นตอนการใช้งาน

### ดูสถานะ service
1. เปิด Uptime Monitor
2. การ์ดสีเขียว = up, แดง = down, เทา = ยังไม่มีข้อมูล
3. ดู uptime % รอบต่าง ๆ

### เพิ่ม Monitor (Admin)
1. คลิก **+ Monitor**
2. กรอกชื่อ + URL
3. คลิก **เพิ่ม**
4. ระบบเริ่ม check ทุก N นาที (default 1-5 นาที)

### ลบ Monitor (Admin)
1. คลิก 🗑 บนการ์ด
2. Confirm dialog
3. ลบ history + config

### ตั้งค่า n8n Push (Admin)
1. คลิก **⚙ n8n**
2. Copy **Push URL** + **Push Key**
3. ใน n8n workflow — ส่ง HTTP POST ไปที่ push URL พร้อม header `X-Push-Key: <key>` และ payload `{name, status}`
4. Status จะ update ในการ์ดที่ตั้งชื่อตรง
5. หากคีย์รั่ว → คลิก ↺ Regenerate (n8n workflow ต้อง update key ใหม่)

### Force Refresh
- คลิก **↺ Refresh** เพื่อ trigger check ทั้งหมด (ไม่ต้องรอ interval)

## Tips

- **HTTP check timeout** — default 10s (config ที่ system-settings)
- **Push mode** — เหมาะกับ service ภายใน network ที่ portal ping ไม่ถึง
- **Uptime %** — คำนวณจาก check history (มี granularity ~1-5 นาที)
- **Color coding** — โครงสร้างง่าย: green = up, red = down; ไม่มี degraded state ในเวอร์ชันปัจจุบัน

## Edge Cases

- **HTTPS cert invalid** — check จะ fail (down); admin แก้ให้ ignore cert ใน config
- **Push key รั่ว** — ↺ regenerate + update n8n workflow
- **Monitor เก่ายังโผล่** — ลบ manual ผ่าน 🗑
- **URL ตั้ง redirect** — check status code อาจเป็น 301/302 (ยังนับเป็น up)
- **1h % หายเมื่อไม่มี check** — check interval ต้อง cover ช่วง 1h นั้น

## ไฟล์ที่เกี่ยวข้อง

- **HTML:** `uptime.html`
- **API:** `/api/uptime/index.php`, `/api/uptime/check.php`, `/api/uptime/config.php`, `/api/uptime/push.php`
