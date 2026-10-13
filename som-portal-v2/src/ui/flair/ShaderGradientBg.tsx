// som-portal-v2/src/ui/flair/ShaderGradientBg.tsx
"use client";

import * as React from "react";

/**
 * Flair option B — pure WebGL mesh gradient (Stripe/Linear style).
 * No library — <100 lines of GLSL + a thin JS driver. ~3 KB.
 *
 * Three animated noise octaves blended with OKLCH-ish colour stops pulled
 * from the active theme at mount time. Pauses when the tab is hidden or
 * prefers-reduced-motion is set.
 */
export function ShaderGradientBg() {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: true, premultipliedAlpha: true });
    if (!gl) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      const w = canvas.clientWidth * dpr;
      const h = canvas.clientHeight * dpr;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };

    const vs = `
      attribute vec2 a_pos;
      void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
    `;
    const fs = `
      precision highp float;
      uniform vec2 u_res;
      uniform float u_t;
      uniform vec3 u_c1;
      uniform vec3 u_c2;
      uniform vec3 u_c3;
      uniform vec3 u_c4;

      // 2D simplex noise (ashima)
      vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
      float snoise(vec2 v){
        const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                           -0.577350269189626, 0.024390243902439);
        vec2 i  = floor(v + dot(v, C.yy));
        vec2 x0 = v - i + dot(i, C.xx);
        vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod(i, 289.0);
        vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
        vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
        m = m*m; m = m*m;
        vec3 x = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x) - 0.5;
        vec3 ox = floor(x + 0.5);
        vec3 a0 = x - ox;
        m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
        vec3 g;
        g.x = a0.x * x0.x + h.x * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
      }

      void main() {
        vec2 uv = gl_FragCoord.xy / u_res;
        float t = u_t * 0.08;
        float n1 = snoise(uv * 1.4 + vec2(t, -t * 0.7));
        float n2 = snoise(uv * 2.8 + vec2(-t * 0.4, t * 1.1));
        float n3 = snoise(uv * 0.7 + vec2(t * 0.3, t * 0.5));
        float w1 = smoothstep(-0.3, 0.9, n1);
        float w2 = smoothstep(-0.4, 0.8, n2 * 0.6 + n3 * 0.4);
        vec3 base = mix(u_c1, u_c2, uv.y);
        vec3 top  = mix(u_c3, u_c4, uv.x);
        vec3 col  = mix(base, top, w1 * 0.6 + w2 * 0.4);
        // film-grain
        float grain = fract(sin(dot(uv * u_res, vec2(12.9898,78.233))) * 43758.5453);
        col += (grain - 0.5) * 0.015;
        gl_FragColor = vec4(col, 1.0);
      }
    `;

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(s));
        return null;
      }
      return s;
    };
    const v = compile(gl.VERTEX_SHADER, vs);
    const f = compile(gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, v);
    gl.attachShader(prog, f);
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    const a_pos = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(a_pos);
    gl.vertexAttribPointer(a_pos, 2, gl.FLOAT, false, 0, 0);

    const u_res = gl.getUniformLocation(prog, "u_res");
    const u_t = gl.getUniformLocation(prog, "u_t");
    const u_c1 = gl.getUniformLocation(prog, "u_c1");
    const u_c2 = gl.getUniformLocation(prog, "u_c2");
    const u_c3 = gl.getUniformLocation(prog, "u_c3");
    const u_c4 = gl.getUniformLocation(prog, "u_c4");

    // Pull colours from CSS variables so the shader follows the theme.
    const cs = getComputedStyle(document.documentElement);
    const hexOrOklchToRgb = (v: string, fallback: [number, number, number]): [number, number, number] => {
      const el = document.createElement("div");
      el.style.color = v;
      document.body.appendChild(el);
      const parsed = getComputedStyle(el).color;
      el.remove();
      const m = parsed.match(/rgba?\(([^)]+)\)/);
      if (!m || !m[1]) return fallback;
      const parts = m[1].split(",").map((p) => parseFloat(p.trim()));
      if (parts.length < 3) return fallback;
      return [(parts[0] ?? 0) / 255, (parts[1] ?? 0) / 255, (parts[2] ?? 0) / 255];
    };
    const c1 = hexOrOklchToRgb(cs.getPropertyValue("--bg-page").trim() || cs.getPropertyValue("--accent").trim(), [0.08, 0.12, 0.2]);
    const c2 = hexOrOklchToRgb(cs.getPropertyValue("--accent").trim(), [0.2, 0.3, 0.6]);
    const c3 = hexOrOklchToRgb(cs.getPropertyValue("--state-info").trim(), [0.3, 0.5, 0.8]);
    const c4 = hexOrOklchToRgb(cs.getPropertyValue("--state-success").trim(), [0.3, 0.7, 0.5]);
    gl.uniform3f(u_c1, ...c1);
    gl.uniform3f(u_c2, ...c2);
    gl.uniform3f(u_c3, ...c3);
    gl.uniform3f(u_c4, ...c4);

    let raf = 0;
    let start = performance.now();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const render = (now: number) => {
      resize();
      gl.uniform2f(u_res, canvas.width, canvas.height);
      gl.uniform1f(u_t, reduce ? 0 : (now - start) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      raf = requestAnimationFrame(render);
    };
    render(start);

    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
      } else {
        start = performance.now() - (performance.now() - start);
        raf = requestAnimationFrame(render);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      gl.deleteProgram(prog);
      gl.deleteShader(v);
      gl.deleteShader(f);
      gl.deleteBuffer(buf);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}
