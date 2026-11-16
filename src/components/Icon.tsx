import type { SVGProps } from "react";

export type IconName = "pulse" | "layers" | "grid" | "link" | "monitor" | "versions" | "settings" | "search" | "refresh" | "arrow" | "key" | "users" | "bell" | "queue" | "globe" | "logout" | "chevron" | "plus" | "alert" | "eye" | "eyeOff" | "close";

const paths: Record<IconName, React.ReactNode> = {
  close: <path d="M6 6l12 12M18 6 6 18" />,
  pulse: <path d="M2 12h5l3-8 4 16 3-8h5" />,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  link: <><path d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(0 -1)" /></>,
  monitor: <><rect x="3" y="3" width="18" height="13" rx="2" /><path d="M8 21h8m-4-5v5" /></>,
  versions: <><path d="M7 3v12a4 4 0 0 0 4 4h6M17 3v4a4 4 0 0 1-4 4H7" /><circle cx="7" cy="3" r="2" /><circle cx="17" cy="3" r="2" /><circle cx="17" cy="19" r="2" /></>,
  settings: <><path d="m9 3-.6 2.3-2 .9-2.2-.7-2 3.5L4 10.7v2.6l-1.8 1.7 2 3.5 2.2-.7 2 .9L9 21h4l.6-2.3 2-.9 2.2.7 2-3.5-1.8-1.7v-2.6L19.8 9l-2-3.5-2.2.7-2-.9L13 3Z" /><circle cx="11" cy="12" r="3" /></>,
  search: <><circle cx="10.5" cy="10.5" r="7" /><path d="m16 16 5 5" /></>,
  refresh: <><path d="M20 7a9 9 0 0 0-15-2L2 8m0-6v6h6M4 17a9 9 0 0 0 15 2l3-3m0 6v-6h-6" /></>,
  arrow: <path d="M7 17 17 7M7 7h10v10" />,
  key: <><circle cx="8" cy="8" r="5" /><path d="m12 12 9 9m-4-4 3-3m-6 0 3-3" /></>,
  users: <><circle cx="9" cy="7" r="4" /><path d="M2 21v-3a7 7 0 0 1 14 0v3m1-18a4 4 0 0 1 0 8m2 4a6 6 0 0 1 3 6" /></>,
  queue: <><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="3.5" cy="6" r="1.5" /><circle cx="3.5" cy="12" r="1.5" /><circle cx="3.5" cy="18" r="1.5" /></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18M5 6h14M5 18h14" /></>,
  logout: <><path d="M9 4H4v16h5m5-13 5 5-5 5m-5-5h12" /></>,
  chevron: <path d="m6 9 6 6 6-6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  alert: <><circle cx="12" cy="12" r="9" /><path d="M12 7v6m0 4h.01" /></>,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="m3 3 18 18M10 5.2a12 12 0 0 1 2-.2c6 0 10 7 10 7a19 19 0 0 1-3 3.6M6.2 6.2A22 22 0 0 0 2 12s4 7 10 7a12 12 0 0 0 5.8-1.8M10 10a3 3 0 0 0 4 4" /></>,
};

export function Icon({ name, size = 20, ...props }: SVGProps<SVGSVGElement> & { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}
