/**
 * The brand mark: a white khatam (8-point star, two interlaced squares) on a brand-red tile. The same star
 * is the assistant's face, so the brand and the agent are one character.
 */
export function BrandMark({ size = 36, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[30%] bg-accent shadow-card ${className}`}
      style={{ width: size, height: size }}
    >
      <Khatam size={Math.round(size * 0.62)} />
    </span>
  );
}

/** The bare star: white, its centre punched out in the brand red of the tile it sits on. */
export function Khatam({ size = 22, className = '' }: { size?: number; className?: string }) {
  const fill = '#FFFFFF';
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" className={className}>
      <path d="M5.6 5.6h12.8v12.8H5.6z" fill={fill} />
      <path d="M12 2.95L21.05 12 12 21.05 2.95 12z" fill={fill} />
      <circle cx="12" cy="12" r="3.1" fill="var(--accent)" />
      <circle cx="12" cy="12" r="1.3" fill={fill} />
    </svg>
  );
}
