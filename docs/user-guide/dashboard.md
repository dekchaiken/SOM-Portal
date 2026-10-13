# Dashboard — คู่มือการใช้งาน

**หน้า:** `dashboard.html`
**บทบาทที่ใช้ได้:** ทุก role (User / Lead / Admin / Dev / External / Super Admin)
**สิทธิ์เข้าถึง:** ทุกคนที่ login แล้ว

## ภาพรวม

Dashboard คือหน้าแรกหลัง login เป็น **Command Center** ที่รวมข้อมูลสำคัญประจำวันของทีมไว้ในหน้าเดียว — ตารางเวรวันนี้, กล่อง Inbox แบบ live, activity feed ของทีม, กราฟสถิติ, และแบนเนอร์ Learning progress.

## ส่วนประกอบหลัก

### 1. Topbar (แถบบนสุด)
- **ชื่อหน้า** — "Dashboard" พร้อมวันที่/เวลาปัจจุบัน
- **ปุ่ม 📝 Requests** — เปิด modal สำหรับส่ง feature request / bug report ให้ admin ทีม
  - **Admin** / **Dev** จะเห็น badge สีแดงแสดงจำนวน request ที่รอตรวจสอบ

### 2. Promo Carousel / Learning Hero (แบนเนอร์บน)
- แสดง mascot "น้องส้ม" 🍊 พร้อมข้อความเชียร์และ progress bar ของคอร์สเรียน
- **Course chips** — รายการคอร์สที่กำลังเรียนพร้อมเปอร์เซ็นต์ (🔒 = ยังไม่ได้ปลดล็อค, ✓ = เรียนจบแล้ว)
- **CTA "เริ่มเลย →"** — พาไปหน้า [Learning](learn.md)
- ถ้าเปิด promo หลายอัน จะมี dot indicator + ปุ่ม ‹ › สลับสไลด์อัตโนมัติ

> **หมายเหตุ**: Hero จะแสดงตาม mood เช่น `celebrate` มี confetti 🎉, `sleepy` = mascot เคลื่อนช้าลง

### 3. Analytics Overview Strip
- แสดง % SM Detection ของปีปัจจุบัน + delta เทียบเดือนก่อน (สีเขียว = ดีขึ้น, สีแดง = แย่ลง)
- Chip ย่อย: **Total / Internal / External** จำนวน incident
- Sparkline mini-chart (12 เดือน)
- คลิกทั้งแถบเพื่อไปหน้า [Analytics](analytics.md) เต็ม

### 4. Today's Schedule (ตารางเวรวันนี้)
สองส่วนย่อย:
- **Internal Team Roster** — คนของทีมคุณเข้าเวรอะไรวันนี้
  - Group: `work` (ทำงาน) / `leave` (ลา) / `oncall` (สแตนบาย)
  - Chip สีต่างกันตามประเภทลา: 🔵 Vacation, 🔴 Sick, 🟠 Half-day
- **External On-Call** — on-call ของทีมอื่น (hover เพื่อดู tooltip)

### 5. Team Inbox Widget (ซ้าย 60%)
- **Filter chips**: All / Unread / ⭐ Starred
- **ช่องค้นหา** — ค้นหาใน subject/from
- **ปุ่ม ↻** — refresh manual
- **LIVE indicator** — ระบบ auto-refresh อัตโนมัติ
- **แถวเมล**: unread จะเป็นตัวหนา + แถบสีน้ำเงินซ้าย; อ่านแล้วจะเป็นสีเทา
- คลิกแถวเพื่อเปิด **slide-out reader** ทางขวา (มี metadata: From, Date, To + เนื้อหา HTML)
- ลิงก์ "Inbox เต็มจอ →" ไปหน้า [Team Inbox](inbox.md)

### 6. Activity Feed (ขวา)
Live feed รวมกิจกรรมทีม สี dot บอกประเภท:
| Dot | ประเภท |
|-----|--------|
| 🟠 board | โพสต์ใหม่บน Web Board |
| 🟢 pinned | โพสต์ที่ถูก pin |
| 🔵 jira | Jira ticket ใหม่ |
| 🟣 email | Email ส่ง |
| 🔷 chat | ข้อความในทีม |
| 🩵 inbox | Inbox update |
| 🟡 test | Service test |
| 🩷 batch | Batch job |
| 🔵 course | Learning progress |
| 🟢 pass | Exam pass |

- ปุ่ม 📝 = เปิด Request modal
- "Board →" = ไปหน้า [Web Board](board.md)

## ขั้นตอนการใช้งาน

### เริ่มวันทำงาน
1. Login → Dashboard เปิดอัตโนมัติ (มี intro animation ครั้งแรก)
2. ดู **Today's Schedule** ว่าใครทำงาน/ลา/on-call วันนี้
3. เช็ค **Team Inbox** ว่ามีเมลใหม่จากลูกค้า/regulator ไหม
4. ดู **Activity Feed** ว่ามี incident/post/batch fail อะไรใหม่
5. เช็ค **Analytics** ว่า SM Detection เดือนนี้เข้าเป้าไหม

### เปิดเมลจาก Inbox widget
1. คลิกแถวเมลใน Team Inbox
2. Reader slide เข้าจากขวา แสดงเนื้อหา
3. กด **Esc** หรือ ✕ เพื่อปิด
4. หากต้องการ reply/forward → ใช้หน้า [Team Inbox](inbox.md) เต็ม

### ส่ง Feature Request / Bug Report
1. คลิกปุ่ม 📝 บน topbar (หรือใน Activity panel)
2. กรอกหัวข้อ + รายละเอียด
3. Admin ทีม (**Admin**) จะได้รับใน Admin → Feature Requests

## Tips & Shortcuts

- **หน้าโหลดช้า?** — Dashboard fetch หลาย endpoint พร้อมกัน (inbox + roster + analytics + activity). ถ้าเน็ตแรกช้า จะเห็น skeleton loader ก่อน
- **ต้องการเปลี่ยน theme?** — คลิก "Dark mode" ที่ sidebar หรือไปหน้า [Settings](settings.md)
- **Super admin** — ใช้ team switcher ที่ sidebar เปลี่ยนมุมมองเป็นทีมอื่นได้ ตารางทั้งหมดจะรีเฟรชตามทีมนั้น

## Edge Cases / สิ่งที่ควรรู้

- **Login intro overlay** — แสดงครั้งเดียวหลัง fresh login (ใช้ `sessionStorage`); refresh หน้าจะไม่เห็นอีก
- **Analytics แถบไม่โผล่** — ถ้า feature `analytics` ปิดในทีมนี้, แถบจะไม่แสดง
- **Learning hero ซ่อน** — ถ้ายังไม่ได้ enroll คอร์สใด ๆ Hero จะไม่แสดง
- **Roster ว่างเปล่า** — ถ้าไม่มีคนเข้าเวรวันนี้ จะแสดง "กำลังโหลด..." หรือ empty state
- **Team Inbox ว่าง** — ถ้าทีมยังไม่ได้ config `mail-config` (SMTP/IMAP), Inbox จะว่าง; ให้ admin ตั้งค่าที่ Admin → Mail Config
- **หน้าแฮงค์** — ถ้ามี error กด F5 refresh หรือคลิก ↻ ที่ inbox toolbar

## ไฟล์ที่เกี่ยวข้อง

- **HTML:** `dashboard.html`
- **JS:** `assets/js/layout.js`, `analytics.js`, `analytics-features.js`, `announcements.js`, `skeletons.js`
- **API:** `/api/inbox`, `/api/board`, `/api/analytics`, `/api/schedule`, `/api/notifications`, `/api/presence`
