import { AtlasMark } from './AtlasMark';

interface AtlasLogoProps {
  /** rail = on dark ink surface; light = on paper surface. */
  variant?: 'rail' | 'light';
  markSize?: number;
  className?: string;
}

/**
 * Full AGHA RM INFRA lockup: the Atlas-peak mark beside a stacked logotype.
 * "ATLAS" (the operating system) is rendered as the platform tag so the
 * company brand stays primary.
 */
export function AtlasLogo({
  variant = 'light',
  markSize = 38,
  className,
}: AtlasLogoProps) {
  const onRail = variant === 'rail';
  const wordmark = onRail ? 'text-paper' : 'text-ink';
  const infra = onRail ? 'text-ochre' : 'text-ochre-deep';
  const tag = onRail ? 'text-paper/45' : 'text-faint';
  return (
    <div className={`flex items-center gap-3 ${className ?? ''}`}>
      <AtlasMark size={markSize} ink={onRail ? 'var(--color-paper)' : undefined} />
      <div className="leading-[1.02]">
        <div
          className={`font-display text-[17px] font-semibold tracking-tight ${wordmark}`}
        >
          AGHA RM
        </div>
        <div className="flex items-baseline gap-2">
          <span
            className={`text-[10px] font-bold uppercase tracking-[0.34em] ${infra}`}
          >
            INFRA
          </span>
          <span className={`text-[9px] font-medium uppercase tracking-[0.22em] ${tag}`}>
            · ATLAS OS
          </span>
        </div>
      </div>
    </div>
  );
}
