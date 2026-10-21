// Marca de "veio de campanha do Google Ads", no card do Pipeline e nos filtros (par do MetaIcon).
export function GoogleAdsIcon({ size = 14, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden fill="none">
      <line x1="6.5" y1="18" x2="11.5" y2="5.5" stroke="#FBBC04" strokeWidth="5" strokeLinecap="round" />
      <line x1="12.5" y1="5.5" x2="17.5" y2="18" stroke="#4285F4" strokeWidth="5" strokeLinecap="round" />
      <circle cx="6.5" cy="18" r="2.9" fill="#34A853" />
    </svg>
  );
}
