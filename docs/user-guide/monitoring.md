# Monitoring — คู่มือการใช้งาน

**หน้า:** `monitoring.html`
**บทบาทที่ใช้ได้:** ทุก role (feature toggle: `monitoring`)

## ภาพรวม

Monitoring = Hub รวม **iframe monitoring dashboard** (Grafana, DataDog, Kibana, custom URL ฯลฯ) จัดกลุ่มไว้ให้เข้าถึงง่าย. รองรับ 3 view mode:
1. **☰ List** — รายการแยก section
2. **▦ Wall 3×3** — grid 3×3 แสดง iframe เต็ม
3. **⊞ Polywall** — layout polygonal / mosaic

## ส่วนประกอบหลัก

### Header
- **View mode buttons**:
  - ☰ **List** (default)
  - ▦ **Wall 3×3**
  - ⊞ **Polywall**
- **Wall Zoom Toggle** (แสดงเฉพาะ mode wall):
  - **FHD** — Full HD scale
  - **HD** — HD
  - **Fit** — fit-to-cell

### List View
- Section แบ่งตาม category (เช่น "Infrastructure", "Application", "Business")
- แต่ละ item = card หนึ่ง monitor
  - ชื่อ + description
  - คลิก → เปิด iframe overlay เต็มจอ

### Wall View (3×3 / Polywall)
- แสดง 9 iframes พร้อมกัน (ปกติ)
- **⛶ Expand** ปุ่มมุมแต่ละ cell → เปิด fullscreen
- ใช้แสดงบน TV / big screen

### Iframe Overlay
เมื่อเปิด monitor:
- **Topbar**: ชื่อ + URL label
- **↗ New Tab** — เปิดใน tab ใหม่
- **✕ Close** — ปิด
- Iframe เต็มจอ

## ขั้นตอนการใช้งาน

### เปิด Monitoring Dashboard
1. List view → คลิก card monitor
2. Iframe overlay โผล่ เต็มจอ
3. ใช้งาน dashboard ปกติ (login Grafana ครั้งแรก)
4. ✕ ปิด หรือ ↗ ย้ายไปแท็บใหม่

### แสดงบน TV Wall
1. คลิก **▦ Wall 3×3**
2. เลือก resolution: **FHD** (สูงสุด), **HD**, **Fit**
3. Layout 3×3 โผล่ — ใช้แสดงจอผนัง
4. Cell ที่สำคัญ → คลิก **⛶** ขยายเต็ม

### Polywall
- Layout ที่ปรับให้ผสม cell ขนาดต่างกัน
- ใช้เมื่อ dashboard บาง cell ต้องใหญ่กว่า (เช่น incident live) เล็กกว่า

## Tips

- **Full-screen browser** (F11) + Wall = viewing wall จริงจัง
- **หน้าล้า** — Grafana หลาย iframe = โหลด CPU เยอะ → ใช้ Wall แค่ที่จำเป็น
- **Login ครั้งเดียว** — Grafana/DataDog SSO จะ share cookie ให้ทุก iframe
- **URL ปรับ time range** — ถ้า URL มี `?from=&to=` ใช้ dynamic range ได้

## Edge Cases

- **iframe ไม่โผล่** — ตรวจ CSP header ใน `.htaccess` (allowlist domain)
- **Grafana login popup ค้าง** — เปิดใน new tab ก่อน login แล้วกลับมา
- **Wall lag** — ลด resolution เป็น HD/Fit
- **CORS block** — บาง dashboard block iframe embed → ต้อง whitelist X-Frame-Options
- **Polywall responsive** — บน mobile จะ fallback เป็น list

## ไฟล์ที่เกี่ยวข้อง

- **HTML:** `monitoring.html`
- **Data:** `data/monitoring.json` (per team)
- **Admin:** จัดการ monitor list ที่ Admin → Tools / Sheets

หมายเหตุ: หน้า monitoring ไม่มี admin page เฉพาะในบางเวอร์ชัน — config อาจอยู่ที่ **Admin → Sidebar Tools** หรือใน data file
