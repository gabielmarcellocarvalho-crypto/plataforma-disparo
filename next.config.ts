import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Upload de fotos em massa (biblioteca do agente) passa pelo server action —
    // o padrão de 1MB é pequeno demais pra várias fotos de quarto de uma vez.
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default nextConfig;
