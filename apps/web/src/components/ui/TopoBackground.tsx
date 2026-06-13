interface TopoBackgroundProps {
  className?: string;
  /** 0–1 stroke opacity for the contour lines. */
  opacity?: number;
  color?: string;
}

/** Elevation-contour cluster centered on (cx, cy). */
function contours(cx: number, cy: number, rings: number, step: number, rot: number) {
  return Array.from({ length: rings }, (_, i) => {
    const rx = 50 + i * step;
    return (
      <ellipse
        key={`${cx}-${cy}-${i}`}
        cx={cx}
        cy={cy}
        rx={rx}
        ry={rx * 0.66}
        transform={`rotate(${rot} ${cx} ${cy})`}
      />
    );
  });
}

/**
 * Faint survey/topographic atmosphere — concentric elevation contours that
 * give the canvas a sense of terrain without competing with content. Purely
 * decorative; sits behind everything and ignores pointer events.
 */
export function TopoBackground({
  className,
  opacity = 0.05,
  color = 'var(--color-ink)',
}: TopoBackgroundProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1200 800"
      fill="none"
      preserveAspectRatio="xMidYMid slice"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className ?? ''}`}
    >
      <g stroke={color} strokeWidth={1.2} opacity={opacity}>
        {contours(1010, 90, 9, 58, -18)}
        {contours(120, 760, 7, 64, 12)}
      </g>
    </svg>
  );
}
