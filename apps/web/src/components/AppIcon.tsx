import type { ReactNode } from 'react';
import type { ProjectIcon } from '@memora/shared';

const paths: Record<ProjectIcon, ReactNode> = {
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />,
  briefcase: <><path d="M4 8h16v12H4z" /><path d="M9 8V5h6v3" /><path d="M4 13h16" /></>,
  home: <><path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></>,
  book: <><path d="M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3Z" /><path d="M4 17a3 3 0 0 1 3-3h11" /><path d="M8 8h6M8 12h5" /></>,
  rocket: <><path d="M14 4c3 0 6 1 6 1s1 3 1 6c0 5-4 9-9 9l-3-3c0-5 4-9 5-13Z" /><path d="m9 15-3 3M6 12H3l2-4h4M12 21v-3l4-2" /><circle cx="15" cy="9" r="1" /></>,
  code: <><path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14" /></>,
  flask: <><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3" /><path d="M8 15h8" /></>,
  palette: <><path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 0-4h-1a2 2 0 0 1 0-4h5a4 4 0 0 0 4-4c0-3-4-6-9-6Z" /><circle cx="7.5" cy="11" r=".8" /><circle cx="9" cy="7" r=".8" /><circle cx="14" cy="6.5" r=".8" /><circle cx="17" cy="9" r=".8" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
  heart: <path d="M20.8 5.8a5.5 5.5 0 0 0-7.8 0L12 6.9l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 22l8.8-8.4a5.5 5.5 0 0 0 0-7.8Z" />,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 3.5a3 3 0 0 1 0 5.8M17 14a5 5 0 0 1 4 5v2" /></>,
  star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z" />,
  music: <><path d="M9 18V5l10-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="16" cy="16" r="3" /></>,
  camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="4" /></>,
  gamepad: <><path d="M6 8h12a4 4 0 0 1 4 4v1a4 4 0 0 1-7 2l-1-1h-4l-1 1a4 4 0 0 1-7-2v-1a4 4 0 0 1 4-4Z" /><path d="M7 11v4M5 13h4M16 12h.01M18 14h.01" /></>,
  leaf: <><path d="M20 4C12 4 5 8 5 16c0 2 1 4 3 4 8 0 12-7 12-16Z" /><path d="M4 21c3-6 7-9 13-13" /></>,
  lightbulb: <><path d="M9 18h6M10 22h4M9 13.5a6 6 0 1 1 6 0c-.8.7-1 1.5-1 2.5h-4c0-1-.2-1.8-1-2.5Z" /></>,
  calculator: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 7h8M8 11h2M14 11h2M8 15h2M14 15h2M8 19h2M14 19h2" /></>,
  terminal: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 16h4" /></>,
  megaphone: <><path d="m3 11 17-6-2 13-6-2-3 5-2-1 2-4-6-2Z" /><path d="M7 15h3" /></>,
  brain: <><path d="M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0-1 5.8A3 3 0 0 0 9 20h1V4Z" /><path d="M15 4a3 3 0 0 1 3 3v1a3 3 0 0 1 1 5.8A3 3 0 0 1 15 20h-1V4Z" /><path d="M9 8h2M13 8h2M9 13h2M13 13h2" /></>,
  scale: <><path d="M12 3v18M5 6h14M5 6l-3 7h6L5 6ZM19 6l-3 7h6l-3-7Z" /><path d="M8 21h8" /></>,
  heartbeat: <><path d="M3 12h4l2-6 4 12 2-6h6" /></>,
  graduation: <><path d="m3 9 9-5 9 5-9 5-9-5Z" /><path d="M7 11v5c3 2 7 2 10 0v-5M21 9v7" /></>,
  shopping: <><path d="M4 7h16l-1 13H5L4 7Z" /><path d="M8 7V5a4 4 0 0 1 8 0v2M8 11v1M16 11v1" /></>,
  chart: <><path d="M4 20V4M4 20h16" /><path d="m7 16 4-5 3 2 5-7" /><circle cx="7" cy="16" r="1" /><circle cx="11" cy="11" r="1" /><circle cx="14" cy="13" r="1" /><circle cx="19" cy="6" r="1" /></>,
  shield: <><path d="M12 3 20 6v6c0 4-3 7-8 9-5-2-8-5-8-9V6l8-3Z" /><path d="m8 12 2.5 2.5L16 9" /></>,
  wrench: <><path d="M14 6a4 4 0 1 0 4 4l-3-3 3-3-1-2-3 3Z" /><path d="m12 10-8 8 2 2 8-8" /></>,
  pen: <><path d="m4 20 4-1 11-11a2.8 2.8 0 0 0-4-4L4 15l-1 5Z" /><path d="m13 6 4 4" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" /></>,
  video: <><rect x="3" y="6" width="13" height="12" rx="2" /><path d="m16 10 5-3v10l-5-3" /></>,
  headphones: <><path d="M4 14v-2a8 8 0 0 1 16 0v2" /><rect x="3" y="14" width="4" height="6" rx="2" /><rect x="17" y="14" width="4" height="6" rx="2" /></>,
  language: <><path d="M3 5h8M7 3v2c0 4-2 7-4 8M5 9c1 2 3 3 5 4" /><path d="M13 21l4-11 4 11M14.5 17h5" /></>,
  plane: <><path d="M22 2 9 15M22 2l-6 20-4-8-8-4 18-8Z" /></>,
  utensils: <><path d="M7 3v8M4 3v5a3 3 0 0 0 6 0V3M7 11v10M17 3v18M17 3c3 2 3 7 0 9" /></>,
  dumbbell: <><path d="M6 8v8M3 10v4M18 8v8M21 10v4M6 12h12" /></>,
  paw: <><circle cx="6" cy="9" r="2" /><circle cx="10" cy="5" r="2" /><circle cx="14" cy="5" r="2" /><circle cx="18" cy="9" r="2" /><path d="M8 15c0-2 2-4 4-4s4 2 4 4c0 3-2 5-4 5s-4-2-4-5Z" /></>,
  seedling: <><path d="M12 21V11M12 13c-5 0-7-3-7-7 4 0 7 2 7 7ZM12 11c5 0 7-3 7-7-4 0-7 2-7 7Z" /><path d="M5 21h14" /></>,
  building: <><path d="M4 21V5l8-3v19M12 21h8V9l-8-4M7 8h2M7 12h2M7 16h2M15 12h2M15 16h2M3 21h18" /></>,
  wallet: <><path d="M4 6h14a2 2 0 0 1 2 2v11H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" /><path d="M4 6V5a2 2 0 0 1 2-2h12M16 13h4" /><circle cx="17" cy="13" r=".5" /></>,
  gavel: <><path d="m14 4 6 6M12 6l6 6M4 20l7-7M3 21h8M14 3l3-2 4 4-2 3-5-5Z" /></>,
  microscope: <><path d="M6 20h12M8 20v-3h8v3M10 17l-2-7 5-3 3 4-6 6ZM14 5l2-3 3 2-2 3" /><path d="M5 10h5" /></>,
  compass: <><circle cx="12" cy="12" r="9" /><path d="m15 9-2 4-4 2 2-4 4-2Z" /></>,
  puzzle: <><path d="M9 4h2a2 2 0 1 1 2 0h2v5a2 2 0 1 1 0 4v5H5v-5a2 2 0 1 1 0-4V4h4Z" /></>,
};

export function AppIcon({ name, size = 16, className }: { name: ProjectIcon; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {paths[name] ?? paths.folder}
    </svg>
  );
}
