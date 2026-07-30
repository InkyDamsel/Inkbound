export const inkboundColors = {
  background: '#0d0910',
  sidebar: '#100b13',
  surface: '#17101b',
  surfaceRaised: '#1d1422',
  surfaceSoft: '#24172a',
  border: 'rgba(197, 160, 89, 0.20)',
  borderStrong: 'rgba(197, 160, 89, 0.42)',
  gold: '#c5a059',
  goldBright: '#e2bd66',
  bronze: '#a8754f',
  ivory: '#f4efe6',
  textMuted: '#ad9fac',
  textFaint: '#807482',
  success: '#73b497',
  danger: '#c97b7b',
} as const;

export const inkboundSpacing = {
  xs: '0.25rem',
  sm: '0.5rem',
  md: '0.75rem',
  lg: '1rem',
  xl: '1.5rem',
  xxl: '2rem',
  section: '2.5rem',
} as const;

export const inkboundRadius = {
  sm: '0.625rem',
  md: '0.875rem',
  lg: '1.125rem',
  pill: '9999px',
} as const;

export const inkboundShadows = {
  card: '0 18px 44px rgba(0, 0, 0, 0.28)',
  cardHover: '0 24px 58px rgba(0, 0, 0, 0.38)',
  overlay: '0 28px 80px rgba(0, 0, 0, 0.58)',
} as const;

export const inkboundTypography = {
  brand: "'Cormorant Garamond', 'Playfair Display', Georgia, serif",
  heading: "'Cormorant Garamond', 'Playfair Display', Georgia, serif",
  body: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
} as const;

export const inkboundBrand = {
  name: 'Inkbound',
  tagline: 'Where every book finds its place.',
  studio: 'Inky Dame Interactive',
} as const;
