/**
 * BuyerAvatar — initials-on-a-color-disc placeholder for an acheteur, matches
 * datao's per-row logo slot. Real logos are out of scope (each ministère would
 * need a curated asset); the deterministic color keeps the same buyer visually
 * recognizable across the catalogue.
 */

const PALETTE: ReadonlyArray<readonly [string, string]> = [
  ['bg-cyan-soft', 'text-cyan'],
  ['bg-emerald-soft', 'text-emerald'],
  ['bg-ochre-soft', 'text-ochre-deep'],
  ['bg-violet-soft', 'text-violet'],
  ['bg-amber-soft', 'text-amber-deep'],
  ['bg-blue-soft', 'text-blue'],
];

function pickPalette(name: string): readonly [string, string] {
  // Cheap deterministic hash → palette index. Good enough for visual stability.
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(h) % PALETTE.length]!;
}

function initials(name: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N} ]+/gu, ' ').trim();
  if (!cleaned) return '?';
  const parts = cleaned.split(/\s+/u).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

const SIZES = {
  sm: 'h-7 w-7 text-[10px]',
  md: 'h-9 w-9 text-xs',
  lg: 'h-12 w-12 text-sm',
} as const;

export function BuyerAvatar({
  name,
  size = 'sm',
  className = '',
}: {
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const [bg, fg] = pickPalette(name);
  return (
    <span
      title={name}
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${bg} ${fg} ${SIZES[size]} ${className}`}
    >
      {initials(name)}
    </span>
  );
}
