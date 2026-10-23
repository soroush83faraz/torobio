import { Khatam } from './BrandMark';

/**
 * The assistant's face: the white brand khatam on a brand-red disc. `thinking` adds a slow red breath
 * (a CSS loop that the reduced-motion rule stops).
 */
export function AssistantAvatar({ size = 40, thinking = false, className = '' }: { size?: number; thinking?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent ring-2 ring-surface ${
        thinking ? 'animate-breathe' : ''
      } ${className}`}
      style={{ width: size, height: size }}
    >
      <span className="girih opacity-[0.14]" />
      <Khatam size={Math.round(size * 0.58)} className="relative" />
    </span>
  );
}
