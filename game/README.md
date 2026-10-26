# ดินแดนสวรรค์ · Game Platform (Web)

เกม MMORPG บนเว็บ (Canvas + vanilla JS) พร้อมเซิร์ฟเวอร์ Node.js ที่ไม่ต้องติดตั้ง dependency เพิ่ม

## รัน

```bash
cd game
node server.js                       # http://localhost:3000
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com node server.js   # เปิด Google Login
PORT=8080 node server.js             # เปลี่ยนพอร์ต
```

ต้องใช้ Node.js 18 ขึ้นไป (แนะนำ 20+) ข้อมูลผู้เล่นเก็บที่ `game/data/db.json` (ไม่ถูก commit)

## หน้าจอ / ระบบที่มีตอนนี้

| หน้า | ไฟล์ | หมายเหตุ |
|------|------|----------|
| Loading ก่อนเข้าเกม | `public/js/screens.js` (`runSplash`) | แถบโหลด + tips |
| Login | `screens.js` | Guest · Google (ต้องตั้ง `GOOGLE_CLIENT_ID`) |
| เลือก/สร้างตัวละคร (สูงสุด 3 ตัว) | `screens.js` | ลบตัวละครได้ |
| Character Designer | `screens.js`, `sprite.js` | เพศ 2 · อาชีพ 4 (นักดาบ/นักฆ่า/นักเวทย์/นักพรต) · ทรงผม · สีผม · สีผิว · สีชุด · ดวงตา · เครื่องประดับ · สุ่มหน้าตา |
| Loading เข้าโลก | `screens.js` (`enterWorld`) | อนิเมชันประตูมิติ |
| แมพ "ดินแดนสวรรค์" | `world.js` | เดิน WASD/ลูกศร/คลิกพื้น, กล้องตาม, ชนกับสิ่งปลูกสร้าง |
| HUD ตามแบบอ้างอิง | `world.js`, `style.css` | ซ้ายบน: ตัวละคร HP/MP · ขวาบน: เมนูลัด · ซ้ายล่าง: เมนูหลัก · ขวาล่าง: สกิล 1-6 (คูลดาวน์) · เควส · แชต |
| Skill Lab | `skill-lab.html`, `js/skill-lab.js` | ออกแบบสกิลและเอฟเฟกต์ พรีวิวสด บันทึกเข้าเซิร์ฟเวอร์ |

## โครงสร้างข้อมูล

- `public/js/data.js` — อาชีพ, ตัวเลือกหน้าตา, สกิลเริ่มต้น (`DEFAULT_SKILLS`), เมนู HUD
- สกิลทุกอันมี `fx` (เอฟเฟกต์) ที่เป็นข้อมูลล้วน: `type` (`burst`/`nova`/`slash`/`projectile`/`beam`/`heal`), สี, จำนวนอนุภาค, ขนาด, ระยะเวลา, ความเร็ว, สั่นจอ
- สกิลที่บันทึกจาก Skill Lab จะ override สกิลเริ่มต้นที่มี `id` ตรงกัน

## API

| Method | Path | ใช้ทำอะไร |
|--------|------|-----------|
| GET | `/api/config` | ค่าเริ่มต้น (อาชีพ, เพศ, Google client id) |
| POST | `/api/auth/guest` | เข้าเล่นแบบ Guest |
| POST | `/api/auth/google` | `{credential}` จาก Google Identity Services |
| POST | `/api/auth/logout` | ออกจากระบบ |
| GET | `/api/me` | ผู้ใช้ปัจจุบัน |
| GET/POST | `/api/characters` | ดู/สร้างตัวละคร |
| GET/PUT/DELETE | `/api/characters/:id` | ดู/แก้หน้าตา/ลบ |
| GET | `/api/skills?classId=` | รายการสกิลที่บันทึกไว้ |
| POST | `/api/skills` | สร้าง/แก้สกิล (ต้องล็อกอิน) |
| DELETE | `/api/skills/:id` | ลบสกิล (ต้องล็อกอิน) |

## ยังไม่ได้ทำ (ขั้นต่อไป)

- เซิร์ฟเวอร์เกมแบบ real-time (WebSocket) สำหรับผู้เล่นหลายคนในแมพเดียวกัน, ปาร์ตี้, แชตรวม
- ระบบ Equipment / Pet / Fashion / Shop / Event จริง (ตอนนี้เป็นหน้าว่างรอพัฒนา)
- มอนสเตอร์ AI และระบบเลเวล/ดรอป/ความเสียหายจริง (ตอนนี้มีแค่หุ่นฝึก)
- Sprite/ภาพ asset แบบเต็มรูปแบบ (ตอนนี้วาดตัวละครด้วย Canvas ทั้งหมด จึงไม่ต้องใช้ไฟล์รูป)
