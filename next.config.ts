import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Upload de fotos em massa (biblioteca do agente) passa pelo server action —
    // o padrão de 1MB é pequeno demais pra várias fotos de quarto de uma vez.
    serverActions: { bodySizeLimit: "25mb" },
  },
  // Headers de segurança (SECURITY_AUDIT.md #5) — defesa em profundidade, nenhum bloqueia
  // funcionalidade existente. CSP aqui é DELIBERADAMENTE mínima (só frame-ancestors, contra
  // clickjacking): a app carrega imagens de vários hosts externos sem next/image (mídia do WhatsApp,
  // Supabase Storage) e o SDK da Meta via <script src> externo (connect.facebook.net,
  // src/components/metacloud-connect.tsx) — uma CSP restritiva de img-src/script-src/connect-src
  // exigiria mapear e manter essa lista, com risco real de quebrar o Embedded Signup ou o carregamento
  // de foto de perfil se algo passar batido. Fica como item de backlog, não bloqueado aqui.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none';" },
        ],
      },
    ];
  },
};

export default nextConfig;
