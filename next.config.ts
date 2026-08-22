import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Upload de fotos em massa (biblioteca do agente) passa pelo server action —
    // o padrão de 1MB é pequeno demais pra várias fotos de quarto de uma vez.
    serverActions: { bodySizeLimit: "25mb" },
  },
  // sharp tem binário nativo (.node) — sem isso, o bundler tenta empacotar junto com a função
  // serverless e quebra em runtime na Vercel ("cannot find module"). Mantém como dependência real
  // de node_modules em vez de tentar traçar/bundlar.
  serverExternalPackages: ["sharp"],
};

export default nextConfig;
