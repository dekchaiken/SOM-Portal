# MA Services — คู่มือการใช้งาน

**หน้า:** `ma-services.html`
**บทบาทที่ใช้ได้:** ทุก role (feature toggle: `ma-services`)
**สิทธิ์แก้ไข:**
- **ดู**: ทุกคน
- **เพิ่ม/แก้/ลบ Usecase & Cut-off**: **Lead**, **Admin**, **Dev** (MA team ที่รับผิดชอบเท่านั้น)
- **ทีมอื่น (รวม super_admin view-as)**: **อ่านอย่างเดียว** ไม่แก้ไขได้

## ภาพรวม

MA Services = **Catalog ของ MA (Maintenance/Managed Application) Services** ที่ทีมดูแล. ประกอบด้วย:
1. **MA Usecases** — เคสการใช้งาน service ต่าง ๆ (TMN, Nano ฯลฯ) พร้อม tool, manual, direct link
2. **Cut-off Services** — service ที่ต้อง cut-off ตามธนาคาร (Bank, Comcode)
3. **MA Overview** — สถิติ ticket MA จาก Jira ประจำปี

## ส่วนประกอบหลัก

### Landing View
เมื่อเข้าครั้งแรกจะเจอ:

#### 📊 MA Overview (สถิติปี)
- **Year picker** — เลือกปี
- **Refresh** — bypass cache ดึงจาก Jira สด
- **Cards**:
  - **Total** — จำนวน ticket MA ทั้งปี
  - **TMN** — จำนวน + %
  - **Nano** — จำนวน + %
- **Distribution bar** — สัดส่วน TMN vs Nano
- **Domain breakdown** — แยกตาม domain (ถ้ามีข้อมูล)
- **Monthly bars** — bar chart รายเดือน

#### Module Grid
- การ์ดแต่ละ module (Usecases, Cut-off ฯลฯ) — คลิกเพื่อเข้า category

### Category View
เลือก Service Type (TMN / Nano) → เข้า data view

### Data View — Tabs
1. **MA Usecases** — ตาราง usecase
2. **Cut-off Services** — ตาราง cut-off

## MA Usecases

### ตาราง
Columns: Service Name, Service Type, Tool Type, Can Change, Remark, Links (doc / link / url / graph), Images

คอลัมน์ **Links** จะแสดง pill สั้นๆ ต่อ usecase:
- `doc` — เปิด Link Manual ในแท็บใหม่
- `link` — เปิด Direct Link ในแท็บใหม่
- `url` — เปิด Custom URL ในแท็บใหม่
- `graph` — เปิด **popup** ที่ฝัง Grafana graph (iframe) — คลิกอีกครั้งที่นอก modal หรือกด `Esc` เพื่อปิด

### เพิ่ม Usecase
1. คลิก **+ Add Usecase**
2. กรอก:
   - **Service Name** (required)
   - **Service Type** (required) — TMN / Nano / อื่น
   - **Tool Type** (required) — เช่น script, dashboard, manual
   - **Can Change** — Yes / No / With approval
   - **Remark** — ข้อมูลเพิ่ม
   - **Link Manual** — URL คู่มือ (Google Docs)
   - **Direct Link** — URL เปิดใช้งานตรง
   - **Custom URL** — URL อื่น ๆ
   - **Grafana Panel URL** — URL กราฟจาก Grafana (ใช้แบบ **Share → Embed** ที่ path เป็น `d-solo` เพื่อให้แสดงเฉพาะกราฟใน popup) → ในตารางจะขึ้น pill `graph`; ถ้า Grafana host ยังไม่อยู่ใน CSP `frame-src` (`.htaccess`) iframe จะโดน browser block
   - **Images** — แนบรูป screenshot (multiple)
3. **Save**

### Filter / Search
- ช่อง search — filter service name / tool / remark
- Dropdown filter tool type

## Cut-off Services

### ตาราง
Columns: Service Name, Bank, Comcode, Cut-off Time, Remark

### เพิ่ม Cut-off
1. คลิก **+ Add Cut-off**
2. กรอก Service, Bank, Comcode, Cut-off Time, Remark
3. **Save**

### Filter / Search
- Search: service / bank / comcode
- Dropdown filter bank

## ขั้นตอนการใช้งาน

### หา Usecase สำหรับ Service ที่ต้อง Support
1. หน้า Landing → คลิก module "MA Usecases"
2. เลือก Service Type (TMN หรือ Nano)
3. ใช้ช่อง search ค้นชื่อ service
4. เจอแล้ว → คลิกแถวเพื่อดูรายละเอียด
5. เปิด **Manual** หรือ **Direct Link** ตาม tool ที่ให้ไว้

### เช็ค Cut-off Time
1. เข้า tab **Cut-off Services**
2. Filter bank
3. ดู cut-off time ของ service นั้น

### ดูสถิติ MA ปีนี้
1. หน้า Landing → ดู MA Overview
2. เลือกปีจาก year picker
3. คลิก 🔄 refresh หากต้องการ real-time (bypass cache)

## Tips

- **Cache hint** — MA Overview cache ประมาณ 1 ชม. (แสดง "cached X min ago")
- **Multi-team** — แต่ละทีมมี MA Services ของตัวเอง (multi-team data path)
- **ทีมอื่นดูของทีมเรา** — ได้ (read-only) แต่แก้ไม่ได้
- **Images** — อัปโหลดหลายรูปได้ต่อ usecase, แสดงเป็น grid

## Edge Cases

- **MA Overview ว่างเปล่า** — ต้องมี Jira config (JIRA_TOKEN) และ project SMC
- **แก้ไม่ได้** — เช็คว่าคุณอยู่ทีมที่ owner service นั้นไหม (super_admin ต้องสลับ team switcher เป็นทีมนั้นก่อน)
- **Refresh ไม่ update** — cache 60 นาที ให้กด refresh manual (icon 🔄)
- **Image upload fail** — ตรวจ file size (< 5MB) และ format (jpg/png/webp)

## ไฟล์ที่เกี่ยวข้อง

- **HTML:** `ma-services.html`
- **JS:** `assets/js/ma-services.js`, `ma-services-stats.js`
- **API:** `/api/ma-usecases`, `/api/ma-cutoffs`, `/api/jira` (สำหรับ stats)
- **Config:** Admin → MA Config
