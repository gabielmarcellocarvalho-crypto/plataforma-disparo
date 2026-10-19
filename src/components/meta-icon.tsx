// Marca de "veio de campanha da Meta" (anúncio Click-to-WhatsApp ou Facebook Leads), no card do Pipeline e nos filtros.
export function MetaIcon({ size = 14, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size * 0.6} viewBox="0 0 40 24" className={className} aria-hidden fill="none">
      <path
        d="M4 16.5c0-6.5 3.2-12 7.4-12 3.5 0 5.8 3.4 8.6 8.2 2.8 4.8 4.9 7.8 7.7 7.8 2.6 0 4.3-2.6 4.3-6 0-4.6-2-8.4-4.9-8.4-2.4 0-4.4 2.4-6.9 6.6-2.7 4.6-4.9 7.8-8.6 7.8C6.6 20.5 4 19 4 16.5Z"
        stroke="#0866FF"
        strokeWidth="3.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
