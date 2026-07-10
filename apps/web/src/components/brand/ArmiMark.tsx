interface ArmiMarkProps {
  size?: number;
  className?: string;
}

/**
 * Marque officielle AGHA RM INFRA — recréation SVG du logo adopté par la
 * société: monogramme "ARMI" en triangle (montagne/chantier) bleu marine +
 * orange, traversé par une route et un tablier de pont. Autonome (aucune
 * dépendance aux tokens du thème: les couleurs du logo sont la charte).
 */
export function ArmiMark({ size = 38, className }: ArmiMarkProps) {
  const navy = '#1e3357';
  const orange = '#e87f1e';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="AGHA RM INFRA"
    >
      {/* Montagne A (flanc gauche marine, flanc droit orange) */}
      <path d="M32 4 6 56h11L32 22l15 34h11L32 4Z" fill={navy} />
      <path d="M32 4v18l15 34h11L32 4Z" fill={orange} opacity="0.92" />
      {/* Fenêtres bâtiment dans le pic */}
      <path d="M29 14h6v7h-6z" fill="#fff" opacity="0.85" />
      <path d="M30.5 23h3v5h-3z" fill="#fff" opacity="0.6" />
      {/* Route qui traverse (double courbe) */}
      <path
        d="M8 52c10-8 22-9 30-16 7-6 12-14 14-22"
        stroke="#fff"
        strokeWidth="4.5"
        strokeLinecap="round"
        opacity="0.95"
      />
      <path
        d="M8 52c10-8 22-9 30-16 7-6 12-14 14-22"
        stroke={orange}
        strokeWidth="1.6"
        strokeDasharray="4 4"
        strokeLinecap="round"
      />
      {/* Haubans du pont côté droit */}
      <g stroke={navy} strokeWidth="1.6" opacity="0.9">
        <path d="M44 42v12" />
        <path d="M50 36v18" />
        <path d="M56 30v24" />
        <path d="M44 54h14" strokeWidth="2.4" />
      </g>
    </svg>
  );
}
