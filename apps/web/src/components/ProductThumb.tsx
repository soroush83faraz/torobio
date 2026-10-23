import { useState } from 'react';
import { Icon, type IconName } from './Icon';

interface Props {
  /** A URL already passed through `safeImageUrl` / `imageOf`. */
  src?: string;
  size?: number;
  /** Shown on the placeholder when there is no image (or it failed to load). */
  icon?: IconName;
  tone?: 'neutral' | 'amber';
  className?: string;
}

/**
 * Product image, square, on a white mat (listing photos are usually cut-outs on white). Without an image — or when
 * it fails — a quiet placeholder: the khatam lattice on a light grey well with a line icon. Decorative: the product name
 * is always printed next to it, so the image carries no alt text of its own.
 */
export function ProductThumb({ src, size = 64, icon = 'bag', tone = 'neutral', className = '' }: Props) {
  const [failed, setFailed] = useState(false);
  const showImage = !!src && !failed;
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[16px] border ${
        showImage ? 'border-line bg-surface' : tone === 'amber' ? 'border-amber/40 bg-amber-soft' : 'border-line bg-sunken'
      } ${className}`}
      style={{ width: size, height: size }}
      data-testid="product-thumb"
      data-has-image={showImage || undefined}
    >
      {showImage ? (
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} className="h-full w-full object-contain p-1.5" />
      ) : (
        <>
          <span className="girih-soft absolute inset-0 opacity-25" aria-hidden="true" />
          <Icon name={icon} size={Math.round(size * 0.4)} className={`relative ${tone === 'amber' ? 'text-amber-ink' : 'text-ink-soft'}`} />
        </>
      )}
    </span>
  );
}
