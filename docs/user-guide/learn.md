# Learning (Learn / Course / Phase / Exam) — คู่มือการใช้งาน

**หน้า:** `learn.html` (hub), `learn-course.html`, `learn-phase.html`, `exam.html`
**บทบาทที่ใช้ได้:** ทุก role (feature toggle: `learning`)
**สิทธิ์:**
- **เรียน / สอบ**: ทุกคน
- **สร้าง/แก้ course/exam**: **Admin**, **Dev** (Admin → Courses / Exams)

## ภาพรวม

Learning suite = ระบบ e-learning ภายในทีม
- 📚 **Courses** — คอร์สเรียน จัดเป็น Phases (หลาย phase ต่อ course)
- 📝 **Exams** — ข้อสอบวัดผลประจำปี พร้อม timer, anti-cheat, consent
- 🍊 **น้องส้ม** (mascot) — ปรากฏใน hero ของ Dashboard เพื่อ push progress

## หน้า Learn (Hub) — `learn.html`

### Hero
- "Welcome 👋" + คำอธิบายพาไป course หรือ exam

### Path Cards (2 ทางเลือก)
1. **📚 คอร์สเรียน** — จำนวนคอร์สพร้อมเรียน + stats
2. **📝 ข้อสอบ** — จำนวนชุดข้อสอบ + stats

### Course Grid
- การ์ดคอร์สทั้งหมด: title, thumbnail, phases, progress bar
- 🔒 **Locked** — ต้องเรียนคอร์สก่อนหน้าให้จบก่อน
- ✓ **Completed** — เรียนจบแล้ว
- **คลิกการ์ด** → เปิดหน้า `learn-course.html?id=<course_id>`

### Exam Grid
- การ์ดข้อสอบ: title, allow retake, passed/failed history
- **คลิก "เริ่มสอบ →"** → เปิด `exam.html?id=<exam_id>` (ใน window ใหม่)

## หน้า Course — `learn-course.html`

### Layout
- ด้านซ้าย: sidebar ของ course
- ด้านขวา: content ของ phase ที่กำลังเรียน (video, text, image, quiz)

### Phase Navigation
- แต่ละ course มีหลาย **Phase** (บทเรียน)
- ต้องเรียน phase ตามลำดับ — จบ phase แล้วปลดล็อก phase ถัดไป
- Progress bar บอก % ที่เรียนไปแล้ว

### Content Types
- **Video** — embed YouTube / Vimeo
- **Text/HTML** — content_html (support markdown)
- **Image** — inline images
- **Quick check** — mini quiz หลัง phase

## หน้า Phase — `learn-phase.html`

- เจาะลึก 1 phase — เนื้อหาเต็ม
- ปุ่ม "เสร็จแล้ว → phase ถัดไป"

## หน้า Exam — `exam.html`

### Start Screen
- แสดง **กติกาการสอบ**:
  - Timer (ถ้าเปิด)
  - Anti-cheat: ห้ามเปลี่ยน tab, ห้าม copy/paste
  - จำนวน violation ที่รับได้
- **Consent** — ติ๊ก "ยอมรับข้อตกลง" (ถ้ากำหนดให้ required)
- ปุ่ม **เริ่มสอบ**

### Exam Screen
- Header: ชื่อ exam + "X / Y" progress + violation counter + timer
- Body: คำถามทีละข้อ
  - Multiple choice (radio)
  - Short answer (textarea)
  - Multi-select (checkbox)
  - รูปภาพในโจทย์ — คลิก zoom
- ปุ่ม **← ก่อนหน้า** / **ถัดไป →**
- **🚩 Flag** — mark ข้อที่ยังไม่แน่ใจ (สีเหลือง)
- **Nav map** — ตัวเลข 1-N ด้านล่าง คลิกกระโดดข้อ (ข้อที่ตอบแล้วเป็นสีเขียว, flag = ส้ม)
- **📤 ส่งคำตอบ** — submit (confirm ก่อน)

### Result Screen
- แสดง คะแนน / เปอร์เซ็นต์ / pass|fail
- แยกดูข้อที่ผิด (ถ้า config ให้เห็น)
- ปุ่ม "กลับหน้า Learn"

## ขั้นตอนการใช้งาน

### เรียน Course
1. หน้า **Learn** → คลิกการ์ดคอร์ส
2. เข้า `learn-course.html` เริ่ม phase 1
3. อ่าน/ดู content จนจบ → คลิก "เสร็จแล้ว"
4. Phase ถัดไปปลดล็อก → เรียนต่อ
5. เมื่อจบทุก phase → course marked completed ✓
6. หาก course มี exam ผูก → ปลดล็อก exam ให้สอบ

### สอบ Exam
1. หน้า **Learn** → คลิก "เริ่มสอบ →" ที่การ์ด exam
2. อ่าน **กติกา** และ ✓ consent (ถ้าต้อง)
3. คลิก **เริ่มสอบ**
4. อ่านโจทย์ + ตอบทีละข้อ (ตอบแล้วปุ่ม "ถัดไป" enable)
5. ใช้ **🚩 Flag** mark ข้อที่ไม่แน่ใจ กลับมาทำใหม่ทีหลัง
6. เมื่อทำครบ → คลิก **📤 ส่งคำตอบ**
7. ดูผลใน Result screen

### ระวัง Anti-Cheat
- **สลับ tab** = violation +1
- **Copy/paste** = violation +1
- ถ้า violation เกิน limit → auto-submit (คะแนนที่มี)

## Tips

- **คอร์สจบไม่ครบ** — Dashboard hero จะเชียร์ให้เรียนต่อ
- **Retake exam** — บาง exam อนุญาต retake (ดูที่การ์ด "Allow retake")
- **Flag ข้อสำคัญ** — ไม่ต้องกลัวลืม กด 🚩 ไว้ก่อน
- **Nav map** — เจาะกลับข้อที่ยังไม่ตอบเร็ว ๆ
- **Cert / Achievement** — สอบผ่านได้ badge (Admin → Achievements)

## Edge Cases

- **เข้า exam แล้วปิด window** — ระบบเก็บ progress ไว้ (ในบาง config); กลับมาต่อได้
- **หลุด network** — ถ้าเน็ตหลุดตอน submit → มี retry logic; ถ้ายังไม่ได้ให้ screenshot คะแนนแล้วแจ้ง admin
- **Course locked** — ต้องเรียน prerequisite ให้จบก่อน (คลิกจะขึ้น toast "ต้องเรียนคอร์สก่อนหน้าให้จบก่อน")
- **Timer หมด** — auto-submit
- **Consent ไม่ติ๊ก** — ปุ่มเริ่มสอบจะ disabled
- **Multi-team** — course/exam ของแต่ละทีมแยกกัน

## ไฟล์ที่เกี่ยวข้อง

- **HTML:** `learn.html`, `learn-course.html`, `learn-phase.html`, `exam.html`
- **API:** `/api/courses`, `/api/exams`, `/api/course-progress`, `/api/exam-attempts`, `/api/achievements`
- **Admin:** `admin/courses.html`, `admin/exams.html`, `admin/achievements.html`
