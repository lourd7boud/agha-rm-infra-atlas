import { ArmiMark } from './ArmiMark';

interface ArmiLogoProps {
  /** rail = on the dark command rail; light = standalone on a dark surface. */
  variant?: 'rail' | 'light';
  markSize?: number;
  className?: string;
}

/**
 * Lockup officiel AGHA RM INFRA (logo adopté): marque ARMI marine/orange +
 * logotype empilé, "ATLAS OS" en tag plateforme. Même interface qu'AtlasLogo
 * pour un swap direct dans le rail et les pages.
 */
export function ArmiLogo({ variant = 'light', markSize = 38, className }: ArmiLogoProps) {
  void variant;
  return (
    <div className={`flex items-center gap-3 ${className ?? ''}`}>
      <ArmiMark size={markSize} />
      <div className="leading-[1.02]">
        <div className="font-display text-[17px] font-bold tracking-tight text-ink">AGHA RM</div>
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.34em] text-[#e87f1e]">
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
