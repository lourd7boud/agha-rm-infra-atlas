/**
 * Hand-built SVG chart primitives for the ATLAS command center — no chart
 * library. All are pure/server-renderable and take CSS-var color strings so
 * they inherit the theme. Decorative axes are kept minimal; the data is the
 * point.
 */

interface GaugeProps {
  value: number;
  max?: number;
  size?: number;
  color?: string;
  track?: string;
  label?: string;
  unit?: string;
}

/** Circular progress ring with a centered value. */
export function Gauge({
  value,
  max = 100,
  size = 96,
  color = 'var(--color-cyan)',
  track = 'var(--color-line)',
  label,
  unit,
}: GaugeProps) {
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, max === 0 ? 0 : value / max));
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
        />
      </svg>
      <div className="absolute flex flex-col items-center leading-none">
        <span className="font-mono text-lg font-bold tabular-nums">{value}</span>
        {unit && <span className="text-[9px] text-faint">{unit}</span>}
        {label && <span className="mt-0.5 text-[9px] text-faint">{label}</span>}
      </div>
    </div>
  );
}

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

/** Donut chart; render the legend in the caller. */
export function Donut({ segments, size = 150 }: { segments: DonutSegment[]; size?: number }) {
  const stroke = 18;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  let offset = 0;
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth={stroke} opacity={0.4} />
      {segments.map((s) => {
        const len = (s.value / total) * c;
        const el = (
          <circle
            key={s.label}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth={stroke}
            strokeDasharray={`${len} ${c - len}`}
            strokeDashoffset={-offset}
          />
        );
        offset += len;
        return el;
      })}
    </svg>
  );
}

export interface Bar {
  label: string;
  value: number;
  color?: string;
}

/** Vertical bar chart. */
export function BarChart({
  bars,
  height = 150,
  color = 'var(--color-cyan)',
}: {
  bars: Bar[];
  height?: number;
  color?: string;
}) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div className="flex items-end gap-2" style={{ height }}>
      {bars.map((b) => (
        <div key={b.label} className="flex flex-1 flex-col items-center justify-end gap-1.5">
          <div className="flex w-full flex-col justify-end" style={{ height: '100%' }}>
            <div
              className="w-full rounded-t-sm"
              style={{
                height: `${(b.value / max) * 100}%`,
                background: b.color ?? color,
                minHeight: b.value > 0 ? 3 : 0,
              }}
            />
          </div>
          <span className="text-[10px] text-faint">{b.label}</span>
        </div>
      ))}
    </div>
  );
}

export interface FunnelStage {
  label: string;
  value: number;
  color?: string;
}

/** Horizontal funnel — bar width proportional to the stage count. */
export function Funnel({ stages }: { stages: FunnelStage[] }) {
  const max = Math.max(1, ...stages.map((s) => s.value));
  return (
    <ul className="space-y-2.5">
      {stages.map((s) => (
        <li key={s.label} className="flex items-center gap-3">
          <span className="w-36 shrink-0 truncate text-xs text-muted">{s.label}</span>
          <div className="h-6 flex-1 rounded-sm bg-sand/50">
            <div
              className="flex h-6 items-center justify-end rounded-sm px-2"
              style={{
                width: `${Math.max(6, (s.value / max) * 100)}%`,
                background: s.color ?? 'var(--color-cyan-deep)',
              }}
            >
              <span className="font-mono text-xs font-bold tabular-nums text-paper">
                {s.value}
              </span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Area sparkline with gradient fill. */
export function AreaSpark({
  points,
  width = 280,
  height = 90,
  color = 'var(--color-cyan)',
  id,
}: {
  points: number[];
  width?: number;
  height?: number;
  color?: string;
  id: string;
}) {
  if (points.length < 2) return null;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1;
  const stepX = width / (points.length - 1);
  const coords = points.map((p, i) => [
    i * stepX,
    height - ((p - min) / range) * (height - 8) - 4,
  ]);
  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${width} ${height} L0 ${height} Z`;
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.35} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
    </svg>
  );
}

/** Tiny inline sparkline for KPI cards. */
export function Sparkline({
  points,
  width = 96,
  height = 28,
  color = 'var(--color-cyan)',
}: {
  points: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (points.length < 2) return null;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1;
  const stepX = width / (points.length - 1);
  const line = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * stepX).toFixed(1)} ${(height - ((p - min) / range) * (height - 4) - 2).toFixed(1)}`)
    .join(' ');
  return (
    <svg width={width} height={height} className="overflow-visible">
      <path d={line} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
