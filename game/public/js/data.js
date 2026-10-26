// Shared game data: classes, appearance options, default skills.
// Default skills are used when the server has no custom skills for a class.
const CLASSES = {
  swordsman: {
    name: 'นักดาบ', color: '#c0392b', weapon: 'sword',
    desc: 'ถึกทน ฟันระยะใกล้ พลังโจมตีสูง',
  },
  assassin: {
    name: 'นักฆ่า', color: '#2c3e50', weapon: 'dagger',
    desc: 'คล่องตัว ดาเมจสูงจากด้านหลัง วิ่งหลบได้ไว',
  },
  mage: {
    name: 'นักเวทย์', color: '#8e44ad', weapon: 'staff',
    desc: 'ใช้เวทระยะไกล พลัง MP สูง ป้อมน้อย',
  },
  priest: {
    name: 'นักพรต', color: '#f1c40f', weapon: 'book',
    desc: 'รักษาและค้ำจุนทีม ใช้พลังศักดิ์สิทธิ์โจมตี',
  },
};

const APPEARANCE_OPTIONS = {
  hairStyle: [
    { v: 0, label: 'สั้น' },
    { v: 1, label: 'ยาว' },
    { v: 2, label: 'หางแฝด' },
    { v: 3, label: 'ฟูชี้' },
  ],
  hair: ['#3b2a20', '#1a1a2e', '#e8c26b', '#ff7aa2', '#7fd1ff', '#c9b6ff', '#f0f0f0', '#ff8c42'],
  skin: ['#ffe0c8', '#f7c9a0', '#e0a77a', '#b97a52', '#fff0f5'],
  outfit: ['#4a7bd0', '#d0485a', '#3fae6a', '#8a5cd6', '#f0b43c', '#2f2f3f', '#ffffff'],
  eyes: [
    { v: 0, label: 'กลม' },
    { v: 1, label: 'เรียว' },
    { v: 2, label: 'ใส' },
  ],
  accessory: [
    { v: 0, label: 'ไม่มี' },
    { v: 1, label: 'ริบบิ้น' },
    { v: 2, label: 'หมวก' },
  ],
};

const DEFAULT_APPEARANCE = {
  skin: '#ffe0c8', hair: '#3b2a20', hairStyle: 0, eyes: 0, outfit: '#4a7bd0', accessory: 0,
};

// Starter skills per class. fx = visual effect config (see effects.js).
const DEFAULT_SKILLS = {
  swordsman: [
    { id: 'sw_slash', classId: 'swordsman', name: 'ฟันดาบ', icon: '⚔️', key: 1, cooldown: 900, mp: 4, damage: 40, range: 110,
      fx: { type: 'slash', color: '#ffd166', color2: '#ffffff', count: 1, size: 70, duration: 260, speed: 0, shake: 4 } },
    { id: 'sw_whirl', classId: 'swordsman', name: 'พายุดาบ', icon: '🌀', key: 2, cooldown: 4000, mp: 14, damage: 90, range: 150,
      fx: { type: 'nova', color: '#ff7a59', color2: '#ffe0a3', count: 30, size: 6, duration: 520, speed: 260, shake: 8 } },
  ],
  assassin: [
    { id: 'as_stab', classId: 'assassin', name: 'แทงลอบ', icon: '🗡️', key: 1, cooldown: 700, mp: 3, damage: 35, range: 100,
      fx: { type: 'slash', color: '#9b8cff', color2: '#2c3e50', count: 1, size: 55, duration: 200, speed: 0, shake: 2 } },
    { id: 'as_dash', classId: 'assassin', name: 'เงาพลิ้ว', icon: '💨', key: 2, cooldown: 3500, mp: 10, damage: 60, range: 180,
      fx: { type: 'beam', color: '#5ee7ff', color2: '#ffffff', count: 10, size: 10, duration: 350, speed: 0, shake: 3 } },
  ],
  mage: [
    { id: 'mg_fire', classId: 'mage', name: 'ลูกไฟ', icon: '🔥', key: 1, cooldown: 800, mp: 6, damage: 55, range: 260,
      fx: { type: 'projectile', color: '#ff7a1a', color2: '#ffe27a', count: 22, size: 9, duration: 450, speed: 520, shake: 2 } },
    { id: 'mg_frost', classId: 'mage', name: 'แช่แข็ง', icon: '❄️', key: 2, cooldown: 5000, mp: 18, damage: 80, range: 160,
      fx: { type: 'nova', color: '#7fd8ff', color2: '#ffffff', count: 40, size: 5, duration: 700, speed: 200, shake: 5 } },
  ],
  priest: [
    { id: 'pr_light', classId: 'priest', name: 'แสงศักดิ์สิทธิ์', icon: '✨', key: 1, cooldown: 900, mp: 6, damage: 45, range: 200,
      fx: { type: 'burst', color: '#fff3a3', color2: '#ffffff', count: 28, size: 7, duration: 600, speed: 180, shake: 1 } },
    { id: 'pr_heal', classId: 'priest', name: 'ฟื้นฟู', icon: '💚', key: 2, cooldown: 3000, mp: 12, damage: 0, range: 0,
      fx: { type: 'heal', color: '#7dff9b', color2: '#ffffff', count: 26, size: 6, duration: 900, speed: 90, shake: 0 } },
  ],
};

// Menus for the HUD. Each opens a window with placeholder content to be filled later.
const HUD_TOP_MENUS = [
  { id: 'event', icon: '🎁', label: 'กิจกรรม' },
  { id: 'welfare', icon: '🏆', label: 'สวัสดิการ' },
  { id: 'starter', icon: '🎒', label: 'แพ็กเริ่มต้น' },
  { id: 'shop', icon: '🏪', label: 'ร้านค้า' },
  { id: 'mail', icon: '✉️', label: 'จดหมาย' },
];

const HUD_BOTTOM_MENUS = [
  { id: 'equip', icon: '🛡️', label: 'อุปกรณ์' },
  { id: 'skill', icon: '📖', label: 'สกิล' },
  { id: 'pet', icon: '🐾', label: 'สัตว์เลี้ยง' },
  { id: 'fashion', icon: '👗', label: 'แฟชั่น' },
  { id: 'quest', icon: '📜', label: 'เควส' },
  { id: 'team', icon: '👥', label: 'ทีม' },
  { id: 'status', icon: '📊', label: 'ตัวละคร' },
];
