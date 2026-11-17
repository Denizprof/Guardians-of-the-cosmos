// 16 px stroke icons, decorative (the button they sit in carries the accessible name).
import type { ReactNode } from 'react';

function Svg({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const IconInvestigations = () => (
  <Svg>
    <circle cx="8" cy="8" r="5.5" />
    <circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none" />
    <path d="M8 1v2.2M8 12.8V15M1 8h2.2M12.8 8H15" />
  </Svg>
);
export const IconFilters = () => (
  <Svg>
    <path d="M2 4h12M4.5 8h7M6.5 12h3" />
  </Svg>
);
export const IconLayers = () => (
  <Svg>
    <path d="M8 2 1.8 5.2 8 8.4l6.2-3.2L8 2Z" />
    <path d="m1.8 8.1 6.2 3.2 6.2-3.2M1.8 10.9l6.2 3.2 6.2-3.2" />
  </Svg>
);
export const IconLens = () => (
  <Svg>
    <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
    <path d="M5.2 10.8c1-3.6 4.600-3.600 5.600 0M8 10.800v-.01" />
    <path d="M6.300 8.300c.9-1.300 2.500-1.300 3.400 0" />
  </Svg>
);
export const IconProbe = () => (
  <Svg>
    <path d="M8 14.200s4.200-3.900 4.200-7.400a4.200 4.200 0 1 0-8.400 0c0 3.500 4.200 7.400 4.200 7.400Z" />
    <circle cx="8" cy="6.700" r="1.500" />
  </Svg>
);
export const IconInspect = () => (
  <Svg>
    <path d="M2.500 5.500v-3h3M10.500 2.500h3v3M13.500 10.500v3h-3M5.500 13.500h-3v-3" />
    <circle cx="8" cy="8" r="1.500" />
  </Svg>
);
export const IconBuildings = () => (
  <Svg>
    <path d="M2.500 13.500h11M3.500 13.500V6.500l3-2v9M6.500 13.500V3l4 1.500v9M10.500 13.500V8h2v5.500" />
  </Svg>
);
export const IconAsk = () => (
  <Svg>
    <path d="M2.500 3.500h11v7.500H7.500L4.500 13.500v-2.500h-2z" />
  </Svg>
);

export const IconInfo = () => (
  <Svg>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 7.300v3.700M8 5v.01" />
  </Svg>
);
export const IconClose = ({ size = 14 }: { size?: number }) => (
  <Svg size={size}>
    <path d="m3.500 3.500 9 9M12.500 3.500l-9 9" />
  </Svg>
);
export const IconExpand = () => (
  <Svg size={14}>
    <path d="M9.500 2.500h4v4M6.500 13.500h-4v-4M13.500 2.500 9 7M2.500 13.500 7 9" />
  </Svg>
);
export const IconShrink = () => (
  <Svg size={14}>
    <path d="M13.500 6.500h-4v-4M2.500 9.500h4v4M9.500 6.500l4-4M6.500 9.500l-4 4" />
  </Svg>
);
export const IconChevron = ({ up = false }: { up?: boolean }) => (
  <Svg size={14}>
    <path d={up ? 'm3.500 10 4.500-4.500L12.500 10' : 'm3.500 6 4.500 4.500L12.500 6'} />
  </Svg>
);
export const IconGrip = () => (
  <Svg size={14}>
    <path d="M5.500 4v.01M5.500 8v.01M5.500 12v.01M10.500 4v.01M10.500 8v.01M10.500 12v.01" strokeWidth="2" />
  </Svg>
);
export const IconExternal = () => (
  <Svg size={12}>
    <path d="M6.500 3.500h-3v9h9v-3M9.500 2.500h4v4M13.500 2.500 7.500 8.500" />
  </Svg>
);
