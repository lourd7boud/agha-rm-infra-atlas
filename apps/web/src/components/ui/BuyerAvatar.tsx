/**
 * BuyerAvatar — datao-style per-row issuer slot. Always renders an <img>:
 *   1. If the buyer matches a curated logo → that logo.
 *   2. Else → the Moroccan royal emblem (datao's universal fallback for
 *      Communes, Wilayas, Provinces, Délégations, foreign agencies, etc.).
 *   Result: every row has a visual identity — never blank, never a generic
 *   colored disc with initials. Same approach datao uses.
 */

import { lookupIssuerLogo, DEFAULT_ISSUER_EMBLEM } from '@/lib/issuer-logos';

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
  const src = lookupIssuerLogo(name) ?? DEFAULT_ISSUER_EMBLEM;
  return (
    <img
      src={src}
      alt={name}
      title={name}
      loading="lazy"
      decoding="async"
      className={`shrink-0 rounded-full border border-line bg-white object-contain ${SIZES[size]} ${className}`}
    />
  );
}
