// Avatar do agente: foto de perfil puxada do WhatsApp quando existe, senão o ícone padrão
// (robô) sobre um chip com gradiente roxo→transparente, igual usado nos outros ícones do app.
export function AgentAvatar({ photoUrl, name, size = "sm" }: { photoUrl: string | null; name: string; size?: "sm" | "lg" }) {
  const dims = size === "lg" ? "w-14 h-14 rounded-xl" : "w-10 h-10 rounded-lg";
  const iconSize = size === "lg" ? 28 : 20;

  if (photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={photoUrl} alt={`Foto de perfil do agente ${name}`} className={`${dims} object-cover shrink-0 border border-border`} />
    );
  }

  return (
    <span className={`grid place-items-center ${dims} bg-gradient-to-br from-primary/25 via-primary/10 to-transparent text-primary-strong shrink-0`} aria-hidden>
      <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="6" cy="3" r="1.1" />
        <line x1="6" y1="4.1" x2="6" y2="7.8" />
        <circle cx="18" cy="3" r="1.1" />
        <line x1="18" y1="4.1" x2="18" y2="7.8" />
        <rect x="4.3" y="8" width="2.1" height="4.4" rx="1.05" />
        <rect x="17.6" y="8" width="2.1" height="4.4" rx="1.05" />
        <path d="M6.7 13C6.7 9 9 5.7 12 5.7s5.3 3.3 5.3 7.3v1.2a2.8 2.8 0 0 1-2.8 2.8H9.5a2.8 2.8 0 0 1-2.8-2.8z" />
        <rect x="8.6" y="11.2" width="6.8" height="3.2" rx="1.3" />
        <circle cx="10.4" cy="12.8" r="0.75" fill="currentColor" stroke="none" />
        <circle cx="13.6" cy="12.8" r="0.75" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}
