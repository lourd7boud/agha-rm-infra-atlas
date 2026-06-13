interface AtlasMarkProps {
  size?: number;
  className?: string;
  /** Render the whole glyph in one color (currentColor) — for tiny/mono uses. */
  mono?: boolean;
  /** Color overrides (default to the theme tokens). */
  ink?: string;
  ochre?: string;
  teal?: string;
  title?: string;
}

/**
 * AGHA RM INFRA brand mark — a letter "A" that reads at once as an Atlas
 * mountain peak and a structural A-frame pylon, capped by an ochre summit and
 * cut at its base by a hydraulic datum line (the company's hydraulic / canal
 * work). Stroke-built so it stays crisp at any size and recolors per surface.
 */
export function AtlasMark({
  size = 40,
  className,
  mono = false,
  ink = 'var(--color-ink)',
  ochre = 'var(--color-ochre)',
  teal = 'var(--color-teal)',
  title = 'AGHA RM INFRA',
}: AtlasMarkProps) {
  const inkC = mono ? 'currentColor' : ink;
  const ochreC = mono ? 'currentColor' : ochre;
  const tealC = mono ? 'currentColor' : teal;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      aria-label={title}
      className={className}
    >
      <title>{title}</title>
      {/* Summit cap — the peak / keystone */}
      <path d="M32 9 L39.2 24 L24.8 24 Z" fill={ochreC} />
      {/* Peak / A-frame legs */}
      <path
        d="M10 55 L32 9 L54 55"
        stroke={inkC}
        strokeWidth="5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Structural tie (the A crossbar) */}
      <path
        d="M16.6 42 L47.4 42"
        stroke={inkC}
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      {/* Hydraulic datum — canal surface lines */}
      <path d="M6 59 L58 59" stroke={tealC} strokeWidth="3.5" strokeLinecap="round" />
      <path
        d="M15 63 L49 63"
        stroke={tealC}
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity={0.7}
      />
    </svg>
  );
}
