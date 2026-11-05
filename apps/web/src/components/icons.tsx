import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 16, ...props }: IconProps): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
    focusable: false,
    ...props,
  };
}

export const CheckIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3.5 8.5l3 3 6-7" />
  </svg>
);

export const AlertIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 2.2l6.2 11H1.8z" />
    <path d="M8 6.5v3M8 11.4v.1" />
  </svg>
);

export const MinusCircleIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="5.8" />
    <path d="M5.5 8h5" />
  </svg>
);

export const QuestionIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="5.8" />
    <path d="M6.4 6.4a1.7 1.7 0 113 1.1c-.6.4-1.4.8-1.4 1.6M8 11.2v.1" />
  </svg>
);

export const ClockIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="5.8" />
    <path d="M8 4.8V8l2.2 1.4" />
  </svg>
);

export const SpinnerIcon = (p: IconProps) => (
  <svg {...base(p)} className={`motion-safe:animate-spin ${p.className ?? ""}`}>
    <path d="M8 2.2a5.8 5.8 0 105.8 5.8" />
  </svg>
);

export const DocIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 1.8h5.2L12 4.6v9.6H4z" />
    <path d="M9 1.8v3h3M6 8h4M6 10.5h4" />
  </svg>
);

export const UploadIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 10.5V2.5M5 5.5l3-3 3 3M2.5 10.5v3h11v-3" />
  </svg>
);

export const DownloadIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 2.5v8M5 7.5l3 3 3-3M2.5 10.5v3h11v-3" />
  </svg>
);

export const RefreshIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M13 8a5 5 0 01-8.7 3.4M3 8a5 5 0 018.7-3.4M11.7 1.8v2.8H8.9M4.3 14.2v-2.8h2.8" />
  </svg>
);

export const SunIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="2.8" />
    <path d="M8 1.5v1.3M8 13.2v1.3M1.5 8h1.3M13.2 8h1.3M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9" />
  </svg>
);

export const MoonIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M13.2 9.6A5.6 5.6 0 016.4 2.8a5.6 5.6 0 106.8 6.8z" />
  </svg>
);

export const MonitorIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="1.8" y="2.5" width="12.4" height="8.5" rx="1" />
    <path d="M5.5 13.8h5M8 11v2.8" />
  </svg>
);

export const ChatIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2.2 3.2h11.6v7.6H7.5l-3 2.6v-2.6H2.2z" />
  </svg>
);

export const ArrowRightIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 8h10M9.5 4.5L13 8l-3.5 3.5" />
  </svg>
);

export const ChevronIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 3.5L10.5 8 6 12.5" />
  </svg>
);

export const SearchIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="7" cy="7" r="4.3" />
    <path d="M10.2 10.2l3.6 3.6" />
  </svg>
);

export const PersonIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="8" cy="5.5" r="2.6" />
    <path d="M3 13.8c.6-2.6 2.6-4 5-4s4.4 1.4 5 4" />
  </svg>
);

export const PacketIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2.5 4.5L8 2l5.5 2.5v7L8 14l-5.5-2.5z" />
    <path d="M2.5 4.5L8 7l5.5-2.5M8 7v7" />
  </svg>
);

export const SwapIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2.5 5.5h10l-2.5-2.5M13.5 10.5h-10l2.5 2.5" />
  </svg>
);

export const CloseIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);
