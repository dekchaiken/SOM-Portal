# SABai — คู่มือการใช้งาน

**หน้า:** `sabai.html`
**บทบาทที่ใช้ได้:** ทุก role (feature toggle: `sabai`)

## ภาพรวม

SABai (สบาย) คือ **AI Assistant ประจำทีม SM** ที่ใช้ **Google NotebookLM** เป็น backend. เอาไว้ถามเรื่องภายในทีม เช่น process, runbook, SLA, incident handling โดยไม่ต้องอธิบาย context เพิ่ม เพราะ NotebookLM อ่าน document ของทีมไว้แล้ว.

> **หมายเหตุ:** หน้านี้ไม่ได้ chat โดยตรง — เป็นหน้า **landing** ที่พาไปเปิด NotebookLM ในแท็บใหม่

## ส่วนประกอบหลัก

### Hero Card
- โลโก้ ✦ + ชื่อ "SABai / สบาย"
- Pills บอกสถานะ: 🟢 Online, 🤖 Google NotebookLM, 📚 Team Knowledge Base
- ปุ่ม **"เปิด SABai ↗"** = พาไปที่ `notebooklm.google.com/notebook/<id>`

### Info Banner
- แจ้งว่าต้อง login Google Account ขององค์กรก่อนใช้งาน

### Capabilities Grid — SABai ช่วยได้อะไร
| ไอคอน | หมวด | ตัวอย่าง |
|-------|------|---------|
| 🚨 | Incident Management | P1-P4, escalation path, การประสานทีม |
| 📋 | SOM Process | Service request, approval flow, handover |
| 📖 | Runbook & Guide | Troubleshooting step-by-step |
| ⏱ | SLA & Priority | Response time, escalation threshold |
| 🧪 | Test & Reconcile | Test service, reconcile transaction |
| 📞 | Contact & Team | On-call, escalation contact |

### Suggested Prompts
ตัวอย่างคำถาม 5 ข้อ — คลิกได้ตรง ๆ ไปเปิด NotebookLM

### How to Use
4 steps: เปิด SABai → พิมพ์คำถาม → ดู source citation → ถ้าข้อมูลไม่อัปเดตแจ้ง admin

## ขั้นตอนการใช้งาน

1. คลิก **"เปิด SABai"** — NotebookLM เปิดในแท็บใหม่
2. Login ด้วย Google Account ขององค์กร (ครั้งแรกเท่านั้น)
3. พิมพ์คำถามใน chat ของ NotebookLM (ไทย หรือ อังกฤษ)
4. ดูคำตอบ + คลิก source citation เพื่อดู document ต้นทาง
5. หาก knowledge base เก่า / ไม่อัปเดต → แจ้ง admin ให้เพิ่ม document ใน NotebookLM (Admin → SABai Knowledge)

## Tips

- **ถามให้ specific** — "SLA ของ P2 คือกี่ชั่วโมง?" ดีกว่า "SLA คืออะไร"
- **ตรวจ source ก่อนใช้** — NotebookLM แสดง reference ที่ใช้ตอบ อย่าเชื่อโดยไม่ตรวจ
- **ถ้าคำตอบผิด/ล้าสมัย** — แจ้ง admin update knowledge base

## Edge Cases

- **เปิดไม่ได้** — Google Account ที่ใช้ต้องได้รับ share NotebookLM ก่อน (admin invite)
- **NotebookLM chat ไม่โผล่** — refresh หน้า NotebookLM หรือลอง incognito
- **ตอบผิดบ่อย** — knowledge base อาจล้าสมัย — แจ้ง admin ที่หน้า Admin

## ไฟล์ที่เกี่ยวข้อง

- **HTML:** `sabai.html`
- **External:** `notebooklm.google.com`
