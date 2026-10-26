// Procedural chibi character renderer. No image assets needed:
// every look is drawn from the appearance config, so the Creator and the
// world use exactly the same drawing code.
const Sprite = {
  // Draw a character with its feet at (x, y). `s` is the scale (1 = ~64px tall).
  draw(ctx, x, y, { gender = 'male', classId = 'swordsman', appearance = DEFAULT_APPEARANCE, dir = 1, t = 0, moving = false, s = 1 }) {
    const a = { ...DEFAULT_APPEARANCE, ...appearance };
    const cls = CLASSES[classId] || CLASSES.swordsman;
    const female = gender === 'female';
    const bob = moving ? Math.abs(Math.sin(t * 12)) * 3 : Math.sin(t * 3) * 1.2;
    const legSwing = moving ? Math.sin(t * 12) * 4 : 0;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.scale(dir, 1); // dir: 1 = right, -1 = left (mirror)

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 16, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // legs
    ctx.fillStyle = '#3a3150';
    ctx.fillRect(-7 + legSwing * 0.3, -14, 5, 12);
    ctx.fillRect(2 - legSwing * 0.3, -14, 5, 12);

    // body (outfit)
    const bw = female ? 13 : 15;
    const by = -34 - bob;
    ctx.fillStyle = a.outfit;
    roundRect(ctx, -bw / 2, by, bw, 22, 6);
    ctx.fill();
    // class accent stripe
    ctx.fillStyle = cls.color;
    ctx.fillRect(-bw / 2, by + 15, bw, 4);

    // arms
    ctx.fillStyle = a.skin;
    ctx.beginPath();
    ctx.arc(-bw / 2 - 1, by + 10 - legSwing * 0.2, 3.5, 0, Math.PI * 2);
    ctx.arc(bw / 2 + 1, by + 10 + legSwing * 0.2, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // weapon held in front arm
    drawWeapon(ctx, cls.weapon, bw / 2 + 4, by + 8);

    // head (big for chibi look)
    const hy = by - 16;
    ctx.fillStyle = a.skin;
    ctx.beginPath();
    ctx.arc(0, hy, 16, 0, Math.PI * 2);
    ctx.fill();

    // back hair (drawn before face for long/twin styles)
    ctx.fillStyle = a.hair;
    if (a.hairStyle === 1) {
      roundRect(ctx, -18, hy - 4, 36, 30, 10); ctx.fill();
    } else if (a.hairStyle === 2) {
      ctx.beginPath(); ctx.arc(-16, hy + 8, 7, 0, Math.PI * 2); ctx.arc(16, hy + 8, 7, 0, Math.PI * 2); ctx.fill();
    }

    // face features
    drawEyes(ctx, a.eyes, hy, a.skin);
    ctx.fillStyle = '#ff8fa3';
    ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.arc(-9, hy + 6, 2.5, 0, Math.PI * 2); ctx.arc(9, hy + 6, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;

    // front hair
    ctx.fillStyle = a.hair;
    if (a.hairStyle === 3) {
      ctx.beginPath();
      ctx.moveTo(-16, hy - 4); ctx.lineTo(-12, hy - 22); ctx.lineTo(-4, hy - 8);
      ctx.lineTo(0, hy - 24); ctx.lineTo(4, hy - 8); ctx.lineTo(12, hy - 22); ctx.lineTo(16, hy - 4);
      ctx.closePath(); ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(0, hy - 2, 16.5, Math.PI * 1.05, Math.PI * 1.95);
      ctx.lineTo(12, hy - 4);
      ctx.quadraticCurveTo(0, hy - 8, -12, hy - 4);
      ctx.closePath(); ctx.fill();
    }

    // accessory
    if (a.accessory === 1) {
      ctx.fillStyle = '#ff5c8a';
      ctx.beginPath(); ctx.moveTo(10, hy - 12); ctx.lineTo(20, hy - 16); ctx.lineTo(18, hy - 8); ctx.closePath(); ctx.fill();
    } else if (a.accessory === 2) {
      ctx.fillStyle = cls.color;
      ctx.fillRect(-14, hy - 14, 28, 5);
      ctx.fillRect(-9, hy - 24, 18, 11);
    }

    ctx.restore();
  },
};

function drawEyes(ctx, style, hy, skin) {
  const eyeW = style === 1 ? 3 : 4;
  const eyeH = style === 1 ? 5 : 7;
  for (const ex of [-6, 6]) {
    ctx.fillStyle = '#2b1f3d';
    ctx.beginPath();
    ctx.ellipse(ex, hy + 1, eyeW / 2 + 0.5, eyeH / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(ex + 1.2, hy - 0.8, 1.6, 0, Math.PI * 2); ctx.fill();
    if (style === 2) {
      ctx.fillStyle = '#5ec8ff';
      ctx.beginPath(); ctx.ellipse(ex, hy + 3, 2.5, 1.5, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function drawWeapon(ctx, weapon, x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.5);
  if (weapon === 'sword') {
    ctx.fillStyle = '#8a6d3b'; ctx.fillRect(-1.5, 0, 3, 7);
    ctx.fillStyle = '#dfe9f5'; ctx.fillRect(-1.5, -22, 3, 22);
  } else if (weapon === 'dagger') {
    ctx.fillStyle = '#444'; ctx.fillRect(-1, 0, 2, 5);
    ctx.fillStyle = '#c9d6e8'; ctx.fillRect(-1, -12, 2, 12);
  } else if (weapon === 'staff') {
    ctx.fillStyle = '#6b4a2b'; ctx.fillRect(-1.5, -26, 3, 34);
    ctx.fillStyle = '#b06bff';
    ctx.beginPath(); ctx.arc(0, -28, 4.5, 0, Math.PI * 2); ctx.fill();
  } else if (weapon === 'book') {
    ctx.fillStyle = '#f5e6c8'; roundRect(ctx, -6, -6, 12, 9, 2); ctx.fill();
    ctx.fillStyle = '#c0392b'; ctx.fillRect(-6, -6, 12, 2);
  }
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
