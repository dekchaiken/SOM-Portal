# Onboarding — คู่มือการใช้งาน

**หน้า:** `onboarding.html`
**บทบาทที่ใช้ได้:** ทุก role (feature toggle: `onboarding`)
**สิทธิ์:**
- **เรียน**: ทุกคน
- **แก้ config chapter/task/quiz**: **Admin**, **Dev** (Admin → Onboarding)

## ภาพรวม

Team Onboarding = คอร์สปฐมนิเทศน์สมาชิกใหม่ของทีม แบ่งเป็น **บท (Chapter)** ที่ต้องทำตามลำดับ. ประกอบด้วย:
- **Text / HTML content** — อ่านเนื้อหา
- **Slide gallery** — รูปภาพ + คำอธิบายทีละ slide
- **Credential / System info** — ข้อมูล login system ทีม (แสดง/ซ่อน password + copy)
- **Task checklist** — ทำเสร็จแล้ว tick
- **Quiz** — คำถามปลายเปิด (พิมพ์คำตอบ + save)
- **Exam** — หลาย choice (multiple choice + retry ถ้าไม่ผ่าน)
- **Notebook** — จดโน้ตส่วนตัวต่อบท

เมื่อทำครบทุกบท → คลิก **"เข้าสู่ Learning →"** = mark onboarding เสร็จ (จะไม่เห็นหน้านี้อีก) และปลดล็อกหน้า [Learning](learn.md).

## ส่วนประกอบหลัก

### Header
- **🧭 Team Onboarding**

### Intro Card
- Title: "ยินดีต้อนรับเข้าทีม 👋"
- Description ของ team

### Main Tab
- **📋 แผน N บท เริ่มต้นการเป็น SM** — แสดงจำนวน chapter total

### Chapter Tabs (แนวนอน)
- แต่ละ tab = 1 chapter
- **สถานะ**:
  - 🔓 Unlocked — ทำได้
  - 🔒 Locked — ยังทำบทก่อนหน้าไม่ครบ
  - ✓ Done — ทำเสร็จแล้ว
- คลิก tab ที่ locked → toast เตือน

### Chapter Body (content ของบทที่เลือก)
ประกอบด้วย block ตามที่ config:

#### Block: Text / HTML
- อ่านเนื้อหา (มี rich formatting)

#### Block: Slide (Image gallery)
- รูปใหญ่ ซ้าย + text อธิบาย ขวา
- Dot navigator ด้านล่าง
- ← / → เปลี่ยน slide
- คลิกรูป = lightbox เต็มจอ

#### Block: Credential Card
- Icon service + Username
- **Password**: ••••••••
  - 👁 Show/hide toggle
  - 📋 Copy to clipboard

#### Block: Task Checklist
- List task พร้อม checkbox
- คลิกเพื่อ toggle → save auto
- เมื่อทุก task ✓ → บทนี้ mark done

#### Block: Notebook (บันทึกส่วนตัว)
- Textarea "จดสิ่งที่เรียนรู้ ความสงสัย หรือแผนของบทนี้…"
- Auto-save เมื่อพิมพ์ (debounce)

#### Block: Quiz (คำถามปลายเปิด)
- Textarea "พิมพ์คำตอบของคุณที่นี่…"
- Auto-save เมื่อพิมพ์
- Status "บันทึกแล้ว"

#### Block: Exam (Multiple choice)
- โจทย์ + choices radio/checkbox
- **Submit** → คะแนน / pass|fail
- **ผ่าน** — green card + "ผ่านการ Onboarding ทั้ง N บท"
- **ไม่ผ่าน** — "กลับไปทำใหม่" retry

#### Block: Flow Diagram
- Tabs สลับ: **System Architecture** / **Team Workflow**
- Diagram แสดง

### Chapter Navigation
- ← **บทก่อนหน้า**
- **บทถัดไป →**

### Complete State
- เมื่อทำครบทุกบท → บนสุดโผล่:
  - "ทำครบทุกบทแล้ว!"
  - ปุ่ม **เข้าสู่ Learning →**

## ขั้นตอนการใช้งาน

### เริ่ม Onboarding
1. Login ครั้งแรก → Sidebar แสดง Onboarding
2. เข้า `onboarding.html`
3. อ่าน intro card
4. คลิก chapter 1

### ทำแต่ละ Chapter
1. อ่าน text / ดู slide / gallery
2. Copy credential ที่ต้องใช้ (Password/Username)
3. Tick task ที่ทำแล้ว
4. จดใน Notebook ถ้าจำเป็น
5. ตอบ Quiz (auto-save)
6. Submit Exam (ถ้ามี)
7. **บทถัดไป →**

### จบ Onboarding
1. ทำครบทุก chapter (tick task + pass exam)
2. คลิก **เข้าสู่ Learning →**
3. Confirm — จะไม่เห็นหน้านี้อีก
4. Redirect ไปหน้า [Learning](learn.md)

### Retry Exam
1. Submit แล้วไม่ผ่าน
2. คลิก **กลับไปทำใหม่**
3. Reset คำตอบ → ตอบใหม่ → submit

## Tips

- **Notebook เก็บถาวร** — จดไว้กลับมาอ่านได้ (auto-save)
- **Password copy** — ใช้ 📋 copy ไม่ต้อง type manual
- **Lightbox** — คลิกรูป slide เพื่อดูเต็ม
- **Progress** — chapter tab แสดง ✓ เมื่อ done
- **Multi-team** — แต่ละทีมมี onboarding ของตัวเอง

## Edge Cases

- **Chapter locked** — ต้องทำบทก่อนหน้าให้ครบ (task ทุก item + exam pass)
- **Notebook หาย** — auto-save เก็บใน backend, ถ้าหายจริงเช็ค network ตอน save
- **Exam ผ่านแล้วอยากทำใหม่** — ปกติทำไม่ได้ (ต้องให้ admin reset)
- **จบไปแล้วอยากกลับมาอ่าน** — เข้า `onboarding.html?review=1` หรือ admin reset
- **Feature ปิด** — sidebar ไม่โผล่ (แต่ user ใหม่ที่ยังไม่จบยังเห็น auto)

## ไฟล์ที่เกี่ยวข้อง

- **HTML:** `onboarding.html`
- **API:** `/api/onboarding` (getConfig, myProgress, toggleTask, saveNotebook, saveQuiz, submitExam, finish)
- **Admin:** `admin/onboarding.html`
