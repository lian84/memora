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
};

export function AppIcon({ name, size = 16, className }: { name: ProjectIcon; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {paths[name] ?? paths.folder}
    </svg>
  );
}
