/** Ícones do wireframe (traço 24x24). */
type P = { size?: number; color?: string; strokeWidth?: number; className?: string };

function Svg({ size = 18, color = 'currentColor', strokeWidth = 2.2, className, children }: P & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

export const IconLive = (p: P) => (
  <Svg size={16} {...p}>
    <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
    <path d="M7.5 7.5a6.4 6.4 0 0 0 0 9M16.5 7.5a6.4 6.4 0 0 1 0 9M4.5 4.5a10.6 10.6 0 0 0 0 15M19.5 4.5a10.6 10.6 0 0 1 0 15" />
  </Svg>
);
export const IconPlay = (p: P) => (
  <Svg size={40} {...p}>
    <path d="M8 5v14l11-7z" fill="currentColor" stroke="none" />
  </Svg>
);
export const IconEye = (p: P) => (
  <Svg color="#FFCE00" {...p}>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);
export const IconExternal = (p: P) => (
  <Svg size={16} {...p}>
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </Svg>
);
export const IconGift = (p: P) => (
  <Svg color="#FFCE00" {...p}>
    <rect x="3" y="9" width="18" height="12" rx="1" />
    <path d="M3 13h18M12 9v12M12 9c-2-4-7-3-5 0M12 9c2-4 7-3 5 0" />
  </Svg>
);
export const IconCheck = (p: P) => (
  <Svg size={14} strokeWidth={3.2} {...p}>
    <path d="M5 12l5 5L20 7" />
  </Svg>
);
export const IconLock = (p: P) => (
  <Svg size={26} strokeWidth={2.4} {...p}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Svg>
);
export const IconShare = (p: P) => (
  <Svg {...p}>
    <circle cx="6" cy="12" r="2.5" />
    <circle cx="18" cy="6" r="2.5" />
    <circle cx="18" cy="18" r="2.5" />
    <path d="M8.2 10.9l7.6-3.8M8.2 13.1l7.6 3.8" />
  </Svg>
);
export const IconBack = (p: P) => (
  <Svg strokeWidth={2.6} {...p}>
    <path d="M15 6l-6 6 6 6" />
  </Svg>
);
export const IconCopy = (p: P) => (
  <Svg size={16} {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 0 1 2-2h9" />
  </Svg>
);
export const IconDownload = (p: P) => (
  <Svg {...p}>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </Svg>
);
export const IconChevronRight = (p: P) => (
  <Svg {...p}>
    <path d="M9 6l6 6-6 6" />
  </Svg>
);
export const IconChevronUp = (p: P) => (
  <Svg strokeWidth={2.6} {...p}>
    <path d="M6 15l6-6 6 6" />
  </Svg>
);
export const IconClose = (p: P) => (
  <Svg strokeWidth={2.6} {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);
export const IconMinus = (p: P) => (
  <Svg strokeWidth={2.6} {...p}>
    <path d="M5 12h14" />
  </Svg>
);
export const IconPlus = (p: P) => (
  <Svg strokeWidth={2.6} {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const IconTrash = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Svg>
);
export const IconPhoto = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="9" cy="10" r="2" />
    <path d="M21 16l-5-5-8 8" />
  </Svg>
);
export const IconBigCheck = (p: P) => (
  <Svg size={32} strokeWidth={3.2} {...p}>
    <path d="M5 12l5 5L20 7" />
  </Svg>
);
