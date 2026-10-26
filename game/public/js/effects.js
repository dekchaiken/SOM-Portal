// Skill effect runtime. A skill's `fx` config (type, colors, count, ...) is
// turned into particles / rings / beams. The same runtime is used by the
// Skill Lab preview, so what you design there is what plays in the world.
//
// fx.type:
//   burst      particles fly out from the caster
//   nova       expanding ring + particles
//   slash      arc sweep in the facing direction
//   projectile orb travels in the facing direction, bursts on arrival
//   beam       streak in the facing direction
//   heal       particles rise upward
class Effects {
  constructor() {
    this.items = [];
    this.texts = []; // floating damage / status text
  }

  // dx, dy: unit direction (for slash / projectile / beam). range: px travel.
  spawn(fx, x, y, { dx = 1, dy = 0, range = 120 } = {}) {
    const now = performance.now();
    const f = { ...fx, x, y, dx, dy, range, born: now };
    if (fx.type === 'projectile') {
      f.px = x; f.py = y;
      f.vx = dx * fx.speed; f.vy = dy * fx.speed;
      f.life = Math.min(fx.duration, (range / Math.max(fx.speed, 1)) * 1000);
    } else {
      f.life = fx.duration;
    }
    f.particles = makeParticles(f);
    this.items.push(f);
    return f;
  }

  text(x, y, str, color = '#fff', big = false) {
    this.texts.push({ x, y, str, color, big, born: performance.now(), life: 900 });
  }

  // Called each frame. Projectiles spawn their own burst on arrival.
  update(dt) {
    const now = performance.now();
    for (const f of this.items) {
      if (f.type === 'projectile' && !f.done) {
        const k = dt / 1000;
        f.px += f.vx * k;
        f.py += f.vy * k;
        if (now - f.born >= f.life) {
          f.done = true;
          this.spawn({ ...f, type: 'burst', count: Math.round(f.count * 0.6), speed: 160, duration: 450 }, f.px, f.py);
        }
      }
      for (const p of f.particles) {
        p.x += p.vx * dt / 1000;
        p.y += p.vy * dt / 1000;
        p.vy += (f.type === 'heal' ? -30 : 120) * dt / 1000;
      }
    }
    this.items = this.items.filter((f) => now - f.born < f.life + 200);
    this.texts = this.texts.filter((t) => now - t.born < t.life);
  }

  draw(ctx, cam) {
    const now = performance.now();
    for (const f of this.items) {
      const age = (now - f.born) / f.life;
      if (f.type === 'projectile') {
        // the orb is drawn while flying; its impact burst is a separate item
        if (!f.done) drawOrb(ctx, cam, f);
        continue;
      }
      if (f.type === 'slash') drawSlash(ctx, cam, f, age);
      if (f.type === 'nova') drawRing(ctx, cam, f, age);
      if (f.type === 'beam') drawBeam(ctx, cam, f, age);
      drawParticles(ctx, cam, f, age);
    }
    for (const t of this.texts) {
      const age = (now - t.born) / t.life;
      ctx.globalAlpha = 1 - age;
      ctx.font = (t.big ? 'bold 22px ' : 'bold 15px ') + 'Sarabun, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#000';
      ctx.fillText(t.str, t.x - cam.x + 1, t.y - cam.y - age * 30 + 1);
      ctx.fillStyle = t.color;
      ctx.fillText(t.str, t.x - cam.x, t.y - cam.y - age * 30);
      ctx.globalAlpha = 1;
    }
  }
}

function makeParticles(f) {
  const out = [];
  const n = Math.max(1, f.count);
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + Math.random() * 0.4;
    const sp = f.speed * (0.5 + Math.random() * 0.7);
    out.push({
      x: f.x, y: f.y,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      c: i % 2 ? f.color : f.color2,
      r: f.size * (0.6 + Math.random() * 0.6),
    });
  }
  return out;
}

function drawParticles(ctx, cam, f, age) {
  ctx.globalAlpha = Math.max(0, 1 - age);
  for (const p of f.particles) {
    ctx.fillStyle = p.c;
    ctx.beginPath();
    ctx.arc(p.x - cam.x, p.y - cam.y, Math.max(1, p.r * (1 - age * 0.5)), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawRing(ctx, cam, f, age) {
  ctx.globalAlpha = Math.max(0, 1 - age);
  ctx.strokeStyle = f.color;
  ctx.lineWidth = 6 * (1 - age) + 1;
  ctx.beginPath();
  ctx.arc(f.x - cam.x, f.y - cam.y, f.range * age + 10, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawSlash(ctx, cam, f, age) {
  const ang = Math.atan2(f.dy, f.dx);
  const sweep = -1.4 + age * 2.8;
  ctx.save();
  ctx.translate(f.x - cam.x, f.y - cam.y);
  ctx.rotate(ang);
  ctx.globalAlpha = Math.max(0, 1 - age * 0.8);
  ctx.strokeStyle = f.color;
  ctx.lineWidth = 10 * (1 - age * 0.5) + 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, 0, f.size, sweep - 0.5, sweep + 0.2);
  ctx.stroke();
  ctx.strokeStyle = f.color2;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawBeam(ctx, cam, f, age) {
  const x0 = f.x - cam.x;
  const y0 = f.y - cam.y;
  const len = f.range * Math.min(1, age * 1.6);
  ctx.globalAlpha = Math.max(0, 1 - age);
  ctx.strokeStyle = f.color;
  ctx.lineWidth = f.size;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x0 + f.dx * len, y0 + f.dy * len);
  ctx.stroke();
  ctx.strokeStyle = f.color2;
  ctx.lineWidth = Math.max(2, f.size / 3);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawOrb(ctx, cam, f) {
  const x = f.px - cam.x;
  const y = f.py - cam.y;
  const g = ctx.createRadialGradient(x, y, 1, x, y, f.size * 2);
  g.addColorStop(0, f.color2);
  g.addColorStop(0.4, f.color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, f.size * 2, 0, Math.PI * 2);
  ctx.fill();
}

// Draws the effect at (x, y) in a standalone canvas, used by the Skill Lab preview.
// Loops automatically so the designer can see it repeatedly.
function previewEffect(canvas, fx, dir = { dx: 1, dy: 0 }) {
  const ctx = canvas.getContext('2d');
  const fxSys = new Effects();
  let last = performance.now();
  let nextAt = 0;
  let running = true;
  const cam = { x: -canvas.width / 2, y: -canvas.height / 2 };
  const cx = 0;
  const cy = 0;

  function frame(now) {
    if (!running) return;
    const dt = Math.min(50, now - last);
    last = now;
    if (now >= nextAt) {
      fxSys.spawn(fx, cx, cy, { dx: dir.dx, dy: dir.dy, range: Math.min(canvas.width, canvas.height) * 0.4 });
      nextAt = now + fx.duration + 600;
    }
    fxSys.update(dt);
    ctx.fillStyle = '#140e28';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // target dummy in the middle
    ctx.fillStyle = '#8a6d3b';
    ctx.fillRect(-6 - cam.x, -28 - cam.y, 12, 40);
    fxSys.draw(ctx, cam);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return () => { running = false; };
}
