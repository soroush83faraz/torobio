import type { SVGProps } from 'react';

/** Directional icons flip in RTL ("forward" points to the inline end = left). Clocks and media icons do not. */
const PATHS = {
  check: 'M5 12.5l4.5 4.5L19 7.5',
  'badge-check': 'M12 3l2.4 1.6 2.9-.1 1 2.7 2.3 1.8-.9 2.8.9 2.8-2.3 1.8-1 2.7-2.9-.1L12 21l-2.4-1.6-2.9.1-1-2.7-2.3-1.8.9-2.8-.9-2.8 2.3-1.8 1-2.7 2.9.1zM8.5 12l2.5 2.5 4.5-5',
  spark: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
  swap: 'M7 8h11l-3-3M17 16H6l3 3',
  question: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.6 9.4a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1.1.9-1.1 1.6M12 16.8h.01',
  'x-circle': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9 9l6 6M15 9l-6 6',
  'tag-off': 'M3 12.5V4h8.5L21 13.5 13.5 21zM8 8.5h.01M4 4l16 16',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5.5M12 7.6h.01',
  close: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  more: 'M12 6h.01M12 12h.01M12 18h.01',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-forward': 'M9 5l7 7-7 7',
  'chevron-back': 'M15 5l-7 7 7 7',
  'arrow-forward': 'M5 12h14M13 6l6 6-6 6',
  'arrow-down': 'M12 5v14M6 13l6 6 6-6',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  building: 'M4 21V6l8-3 8 3v15M9 21v-5h6v5M8 9.5h.01M12 9.5h.01M16 9.5h.01M8 13h.01M12 13h.01M16 13h.01',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6',
  edit: 'M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17zM14 7l3 3',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20a7.5 7.5 0 0 1 15 0',
  alert: 'M12 4l9 16H3zM12 10v4.5M12 17.4h.01',
  refresh: 'M20 11a8 8 0 0 0-14.5-3.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14.5 3.5M20 20v-4.5h-4.5',
  send: 'M4 12l16-8-6 16-2.5-6.5z',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  route: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 17h6a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h6',
  bag: 'M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2',
  doc: 'M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5',
  dashed: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  pin: 'M12 21s6-5.5 6-11a6 6 0 0 0-12 0c0 5.5 6 11 6 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  eye: 'M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  cctv: 'M3.5 8.2l13-3.7 1.9 6.4-13 3.7zM14.5 8.6h.01M7.6 13.8l1.2 3.7h4.4M13.2 15.2v4.3M18.4 7.4l2.1-.6',
  bolt: 'M13.2 3L5.5 13.4h6.1L10.8 21l7.7-10.4h-6.1z',
  phone: 'M8.2 3h7.6a1.7 1.7 0 0 1 1.7 1.7v14.6a1.7 1.7 0 0 1-1.7 1.7H8.2a1.7 1.7 0 0 1-1.7-1.7V4.7A1.7 1.7 0 0 1 8.2 3zM10.8 17.8h2.4',
  image: 'M4.5 5h15a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3.5 15.5l4.8-4.6 4.2 4 2.4-2.2 5.6 5.1M15.2 9.2h.01',
} as const;

export type IconName = keyof typeof PATHS;
const DIRECTIONAL: IconName[] = ['chevron-forward', 'chevron-back', 'arrow-forward', 'send', 'route'];

interface Props extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 20, className = '', ...rest }: Props) {
  const flip = DIRECTIONAL.includes(name) ? 'rtl:-scale-x-100' : '';
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${flip} ${className}`}
      {...rest}
    >
      <path d={PATHS[name]} strokeDasharray={name === 'dashed' ? '3 3' : undefined} />
    </svg>
  );
}
