type Props = { name: string; className?: string };

const P: Record<string, React.ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  check: <><path d="M4 12.5 9 17.5 20 6.5" /></>,
  layers: <><path d="M12 3 3 8l9 5 9-5-9-5Z" /><path d="M3 13.5 12 18.5l9-5" /></>,
  inbox: <><path d="M3 13h5l1.5 3h5L16 13h5" /><path d="M5.5 5h13l2.5 8v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5l2.5-8Z" /></>,
  bulb: <><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5.9 1.2.9 1.9v.2h5.2v-.2c0-.7.3-1.4.9-1.9A6 6 0 0 0 12 3Z" /></>,
  receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" /><path d="M9 8h6M9 12h6" /></>,
  card: <><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M2.5 10h19M6.5 15h3" /></>,
  bank: <><path d="M3 10h18M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18M12 3l9 5H3l9-5Z" /></>,
  repeat: <><path d="M4 9a5 5 0 0 1 5-5h9m0 0-3-3m3 3-3 3" /><path d="M20 15a5 5 0 0 1-5 5H6m0 0 3 3m-3-3 3-3" /></>,
  shield: <><path d="M12 3 5 6v6c0 4.2 2.9 7.9 7 9 4.1-1.1 7-4.8 7-9V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></>,
  chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M17.5 14.5A6.5 6.5 0 0 1 21.5 20" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  wrench: <><path d="M14.7 6.3a4 4 0 0 0 5 5L21 9.4a6 6 0 0 1-8.6 6.9l-5 5a2.1 2.1 0 0 1-3-3l5-5A6 6 0 0 1 16.3 4l-1.6 2.3Z" /></>,
  phone: <><path d="M6 3h3l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4 5.2 2 2 0 0 1 6 3Z" /></>,
  home: <><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-9.5Z" /></>,
  box: <><path d="M12 3 3.5 7.5v9L12 21l8.5-4.5v-9L12 3Z" /><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" /></>,
  folder: <><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /></>,
  book: <><path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5v-15Z" /><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3" /></>,
  chat: <><path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.2A8 8 0 1 1 21 12Z" /></>,
  lock: <><rect x="4.5" y="10" width="15" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 5 5" /></>,
  back: <><path d="M15 5l-7 7 7 7" /></>,
  undo: <><path d="M4 9h11a5 5 0 0 1 0 10h-6" /><path d="m8 5-4 4 4 4" /></>,
  chevron: <><path d="m9 5 7 7-7 7" /></>,
  paperclip: <><path d="M20 11.5 12.2 19.3a5 5 0 0 1-7.1-7.1l8.5-8.5a3.5 3.5 0 1 1 5 5l-8.5 8.5a2 2 0 0 1-2.8-2.8l7.8-7.8" /></>,
  trash: <><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" /></>,
  pin: <><path d="M14.5 3 21 9.5l-3.2 1.2-3 3 .5 4.3-2.4-2.4-4.6 4.6M11.9 11.9 9.5 9.5" /><path d="m9.4 9.4 1.2-3.2L14.5 3" /></>,
  logout: <><path d="M14 7V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-2" /><path d="M10 12h11m0 0-3-3m3 3-3 3" /></>,
  alert: <><path d="M12 3.5 22 20H2L12 3.5Z" /><path d="M12 10v4M12 17h.01" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5.5l3.5 2" /></>,
  download: <><path d="M12 3v12m0 0-4-4m4 4 4-4" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></>,
  file: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" /><path d="M14 3v5h5" /></>,
  x: <><path d="M6 6l12 12M18 6 6 18" /></>,
  filter: <><path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z" /></>,
  map: <><path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5V4l-6 2.5L9 4Z" /><path d="M9 4v13M15 6.5v13" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9M16 7l3 3M14 9l2 2" /></>,
  moon: <><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" /></>,
  zap: <><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3.1 14H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>,
  building: <><rect x="4" y="3" width="16" height="18" rx="1.5" /><path d="M9 21v-4h6v4M8 7h2M14 7h2M8 11h2M14 11h2" /></>,
  bookmark: <><path d="M6 3h12v18l-6-4-6 4V3Z" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
  menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14.3-4.3L4 9M4 4v5h5" /><path d="M4 13a8 8 0 0 0 14.3 4.3L20 15M20 20v-5h-5" /></>,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></>,
  eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  door: <><rect x="3" y="4" width="18" height="17" rx="1.5" /><path d="M3 9h18M3 13h18M3 17h18M10.5 19.2h3" /></>,
  pen: <><path d="M3 21c3-1 5-1 7-3L20 8a2.8 2.8 0 0 0-4-4L6 14c-2 2-2 4-3 7Z" /><path d="M14 6l4 4" /></>,
  external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>,
  sort: <><path d="M8 5v14m0 0-3-3m3 3 3-3M16 19V5m0 0-3 3m3-3 3 3" /></>,
  up: <><path d="M12 19V5m0 0-6 6m6-6 6 6" /></>,
  down: <><path d="M12 5v14m0 0-6-6m6 6 6-6" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3.5 2" /></>,
  wallet: <><path d="M3 7a2 2 0 0 1 2-2h13v4" /><path d="M3 7v11a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2Z" /><path d="M16.5 14.5h.01" /></>,
  scale: <><path d="M12 3v18M7 21h10M5 7h14M5 7l-3 7a3.5 3.5 0 0 0 6 0L5 7ZM19 7l-3 7a3.5 3.5 0 0 0 6 0l-3-7Z" /></>,
  coral: <><path d="M12 21v-5M12 16c0-3-3-4-3-7M12 16c0-3 3-4 3-7M9 9C9 7 7.5 6 7.5 4M15 9c0-2 1.5-3 1.5-5M12 16V6" /></>,
  clipboard: <><rect x="5" y="4.5" width="14" height="16.5" rx="2" /><path d="M9 4.5V3.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 3.5v1" /><path d="m8.5 12 2.2 2.2L15.5 10" /></>,
  sparkle: <><path d="M11 3c.6 2.8 1.2 3.4 4 4-2.8.6-3.4 1.2-4 4-.6-2.8-1.2-3.4-4-4 2.8-.6 3.4-1.2 4-4Z" /><path d="M18 13c.35 1.6.7 1.95 2.3 2.3-1.6.35-1.95.7-2.3 2.3-.35-1.6-.7-1.95-2.3-2.3 1.6-.35 1.95-.7 2.3-2.3Z" /><path d="M6.5 14c.3 1.4.6 1.7 2 2-1.4.3-1.7.6-2 2-.3-1.4-.6-1.7-2-2 1.4-.3 1.7-.6 2-2Z" /></>,
};

export default function Icon({ name, className = "w-4 h-4" }: Props) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {P[name] ?? P.file}
    </svg>
  );
}
