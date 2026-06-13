import { AtlasMark } from './AtlasMark';

interface AtlasLogoProps {
  /** rail = on the dark command rail; light = standalone on a dark surface. */
  variant?: 'rail' | 'light';
  markSize?: number;
  className?: string;
}

/**
 * AGHA RM INFRA lockup for the dark command center: the Atlas-peak mark in
 * cyan beside a stacked logotype, with "ATLAS OS" as the platform tag.
 */
export function AtlasLogo({
  variant = 'light',
  markSize = 38,
  className,
}: AtlasLogoProps) {
  void variant;
  return (
    <div className={`flex items-center gap-3 ${className ?? ''}`}>
      <AtlasMark
        size={markSize}
        ink="var(--color-cyan)"
        ochre="var(--color-cyan-deep)"
        teal="var(--color-teal)"
      />
      <div className="leading-[1.02]">
        <div className="font-display text-[17px] font-bold tracking-tight text-ink">
          AGHA RM
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.34em] text-cyan">
            INFRA
          </span>
          <span className="text-[9px] font-medium uppercase tracking-[0.22em] text-faint">
            · ATLAS OS
          </span>
        </div>
      </div>
    </div>
  );
}
