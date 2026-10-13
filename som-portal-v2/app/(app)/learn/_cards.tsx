// som-portal-v2/app/(app)/learn/_cards.tsx
// Shared Learn cards: cover band with a colour gradient, SVG progress ring, chips.
import * as React from "react";
import { Icon, type IconName } from "@/icons";
import { cn } from "@/ui/cn";

export function coverGradient(color: string | undefined): string {
  const base = color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#f26419";
  return `linear-gradient(135deg, ${base} 0%, color-mix(in srgb, ${base} 45%, #000) 100%)`;
}

export function ProgressRing({
  percent,
  size = 56,
  stroke = 5,
  label,
}: {
  percent: number;
  size?: number;
  stroke?: number;
  label?: string;
}) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const center = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label ?? `${p}%`} className="shrink-0">
      <circle cx={center} cy={center} r={r} fill="none" stroke="var(--bg-raised)" strokeWidth={stroke} />
      <circle
        cx={center}
        cy={center}
        r={r}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - p / 100)}
        transform={`rotate(-90 ${center} ${center})`}
        style={{ transition: "stroke-dashoffset 600ms ease" }}
      />
      <text x={center} y={center} textAnchor="middle" dominantBaseline="central" fill="var(--text-strong)" fontSize={size > 48 ? 13 : 11} fontWeight={600}>
        {label ?? `${p}%`}
      </text>
    </svg>
  );
}

export type Tone = "neutral" | "success" | "warning" | "danger" | "info";

const TONE: Record<Tone, string> = {
  neutral: "text-[var(--text-muted)]",
  success: "text-[var(--state-success)]",
  warning: "text-[var(--state-warning)]",
  danger: "text-[var(--state-danger)]",
  info: "text-[var(--state-info)]",
};

export function Chip({ children, tone = "neutral", icon }: { children: React.ReactNode; tone?: Tone; icon?: IconName }) {
  return (
    <span className={cn("glass-chip inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium", TONE[tone])}>
      {icon ? <Icon name={icon} size={12} /> : null}
      {children}
    </span>
  );
}

/** Cover band with the colour gradient and a large faded icon. The icon badge sits on its lower edge. */
export function CoverBand({ color, icon, fallbackIcon }: { color: string; icon?: string; fallbackIcon: IconName }) {
  const name = (icon && isIconName(icon) ? icon : fallbackIcon) as IconName;
  return (
    <div className="relative h-24 overflow-hidden" style={{ background: coverGradient(color) }}>
      <div className="absolute -right-4 -top-4 opacity-20">
        <Icon name={name} size={120} />
      </div>
      <span className="absolute bottom-0 left-5 grid h-11 w-11 translate-y-1/2 place-items-center rounded-2xl bg-[var(--bg-card)] text-[var(--text-strong)] shadow-lg">
        <Icon name={name} size={20} />
      </span>
    </div>
  );
}

const ICON_NAMES: readonly string[] = [
  "activity", "bell", "book", "boxes", "calendar", "check", "clock", "database", "eye", "file", "filter", "flag", "gauge",
  "hammer", "home", "info", "layers", "dashboard", "link", "loader", "logout", "mail", "menu", "message", "moon", "more",
  "package", "pencil", "pin", "play", "plus", "refresh", "search", "server", "settings", "shield", "sparkles", "star", "sun",
  "trash", "user", "users", "x",
];

function isIconName(v: string): v is IconName {
  return ICON_NAMES.includes(v);
}

export function CardShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("glass flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] transition-transform duration-200 hover:-translate-y-0.5", className)}>
      {children}
    </div>
  );
}
