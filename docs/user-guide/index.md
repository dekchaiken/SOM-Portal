# SOM-Portal — User Guide (ฝั่ง User)

คู่มือการใช้งาน SOM-Portal สำหรับ user ทั่วไปในทีม แต่ละไฟล์ในโฟลเดอร์นี้จะอธิบายฟีเจอร์หลักของหน้านั้น ๆ พร้อมสิทธิ์การใช้งาน (role), ขั้นตอนการใช้ (step-by-step), และ edge cases ที่ควรระวัง.

## โครงสร้างสิทธิ์: Role + Team = 2 แกนแยกกัน

SOM-Portal เป็น **multi-team platform** — ผู้ใช้ทุกคนถูกแบ่งด้วย **2 มิติที่แยกจากกัน**:

- **Team** — สังกัดทีม (เช่น `sm`, ทีมอื่น ๆ) เก็บใน JWT `team` claim, ตัดสินว่า user เห็น/แก้ข้อมูลของทีมไหน (data อยู่ใน `data/{team}/…`)
- **Role** — ระดับสิทธิ์ในทีมนั้น ไม่ผูกกับชื่อทีม

> 💡 **หมายเหตุเรื่อง naming**: ในโค้ดปัจจุบัน role ยังมี prefix `sm_` (เช่น `sm_user`, `sm_admin`) ซึ่งเป็น **legacy naming ตั้งแต่ยุค single-team** — ไม่ได้แปลว่าเฉพาะทีม SM. อ่านเป็น "user / lead / admin" ธรรมดา, ส่วนทีมจริง ๆ อยู่ที่ JWT team claim.

## Role ที่มีในระบบ

| Role ในโค้ด | อ่านเป็น | สิทธิ์คร่าว ๆ |
|-------------|----------|--------------|
| `sm_user` | **User** | ผู้ใช้ทั่วไปในทีม อ่าน/สร้างเนื้อหาส่วนตัวได้ |
| `sm_lead` | **Lead** | หัวหน้าทีม แก้ไข/อนุมัติเนื้อหาทีม |
| `sm_admin` | **Admin** | Admin ประจำทีม จัดการ user/setting ของทีม |
| `dev_sm` | **Dev** | Developer ระบบ (มี Dev Toolbar + สิทธิ์เทียบเท่า admin) |
| `external` | **External** | ผู้ใช้ภายนอกทีม สิทธิ์จำกัด |
| `super_admin` | **Super Admin** | ผู้ดูแลระดับ platform ข้ามทุกทีมได้ |
| `super_viewer` | **Super Viewer** | ดู "view-as" ได้ทุกทีม แต่แก้ไม่ได้ |

> **ตัวอย่าง**: user ทีม `sm` ที่มี role `sm_admin` และ user ทีม `xxx` ที่มี role `sm_admin` มี **สิทธิ์เท่ากัน** แต่ **มองเห็นข้อมูลคนละทีม** — เพราะ team ตัดสิน scope, role ตัดสินสิทธิ์.

> **Super admin** สลับดู "view-as" ทีมอื่นได้ผ่าน team switcher ที่ sidebar. Feature ต่าง ๆ ถูกเปิด/ปิดผ่านหน้า Admin → Menu Permissions ต่อทีม.

## สารบัญคู่มือแต่ละหน้า

### 🏠 หน้าหลัก
- [Dashboard](dashboard.md) — หน้าแรกหลัง login สรุปกิจกรรม/ตัวชี้วัดของทีม
- [Profile](profile.md) — จัดการข้อมูลส่วนตัว, avatar, พาสเวิร์ด
- [Change Password](change-password.md) — เปลี่ยนพาสเวิร์ด
- [Settings](settings.md) — เลือก theme (Glass/Enterprise/Console/Warm) + dark mode

### 📋 งานประจำวัน / ทีม
- [Web Board](board.md) — บอร์ดโพสต์ประกาศ/ปัญหา/incident ของทีม
- [Team Docs](sheets.md) — Google Sheets ที่ embed ใช้ในทีม
- [SABai](sabai.md) — เช็คสุขภาพจิต/mood ประจำวัน
- [Shift Schedule](schedule.md) — ตารางเวรของทีม
- [PW Schedule](pw-schedule.md) — ตารางเวร Password (SM team only)
- [Team Inbox](inbox.md) — กล่องแจ้งเตือน notifications
- [Sync Up](syncup.md) — พื้นที่ sync งานประจำสัปดาห์

### 🎫 Ticket / Report
- [SMC Ticket (Send Email)](send-email.md) — สร้าง Jira ticket ผ่าน template
- [Weekly Report](weekly-report.md) — รายงานสรุปประจำสัปดาห์
- [Analytics](analytics.md) — Dashboard สถิติของทีม

### 🔧 MA / Service
- [MA Services](ma-services.md) — Catalog service ที่ทีม MA ดูแล
- [Service Test](test-service.md) — ทดสอบ endpoint ของ service
- [Onboarding](onboarding.md) — เอกสาร onboard เข้าทีม

### 📊 Monitoring
- [Monitoring](monitoring.md) — Hub รวม monitoring links
- [Batch Monitor](batch-monitor.md) — ติดตามสถานะ batch job
- [Alert Monitor](alert-monitor.md) — รวม alert จากทีม
- [Uptime Monitor](uptime.md) — Uptime ของ service
- [EKS Restart Monitor](restart-monitor.md) — ติดตาม restart pod ใน EKS

### 📚 Learning / Knowledge
- [Learning](learn.md) — Course/Phase/Exam ระบบเรียนรู้ในทีม
- [Knowledge Base](knowledge-base.md) — คลังความรู้ทีม
- [Ops Runbook](ops-runbook.md) — Runbook ปฏิบัติการ

## สิ่งที่ควรรู้ก่อนใช้งาน

### การ Login
- เข้าที่ `/login.html` ใส่ email + password
- Session อยู่ได้ 8 ชม. (default) หรือ 30 วันหาก tick "Remember me"
- Login ผิด 5 ครั้ง → ถูกล็อค 15 นาที
- Session token เก็บใน `localStorage` (`som_token`)

### Sidebar / Navigation
- ด้านซ้ายมือคือ sidebar หลัก มี section: MAIN / TOOLS / EXT TOOLS / ADMIN / DEV
- Item ที่มีสัญลักษณ์ 🔒 = ทีมของคุณไม่มีสิทธิ์เข้าถึง (ติดต่อ admin เพื่อเปิด)
- Super admin จะเห็น team switcher ด้านบน sidebar
- ปุ่ม ‹ ด้านบน sidebar = ย่อ/ขยาย sidebar

### Theme
- คลิก "Dark mode" ที่ sidebar เพื่อสลับ light/dark
- เลือก theme (Glass/Enterprise/Console/Warm) ได้ที่หน้า Settings
- Console theme บังคับใช้ dark mode ตลอด

### Feature Toggle ต่อทีม
- แต่ละทีมเปิด/ปิดฟีเจอร์ต่างกัน. หากเมนูที่คู่มือบอกไม่ปรากฏใน sidebar → ทีมยังไม่ได้เปิด feature นั้น
- แจ้ง sm_admin ของทีมให้เปิดที่ Admin → Menu Permissions
