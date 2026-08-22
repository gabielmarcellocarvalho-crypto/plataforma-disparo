"use client";

import Script from "next/script";
import { useEffect, useRef, useState, useTransition } from "react";
import { connectMetaCloudInstance } from "@/app/actions/whatsapp";

declare global {
  interface Window {
    FB?: {
      init: (opts: { appId: string; xfbml: boolean; version: string }) => void;
      login: (
        callback: (response: { authResponse?: { code?: string } }) => void,
        opts: { config_id: string; response_type: string; override_default_response_type: boolean; extras: Record<string, unknown> }
      ) => void;
    };
  }
}

// Payload que o popup de Embedded Signup manda via postMessage pro navegador (formato documentado
// pela Meta) — é daqui que tiramos waba_id/phone_number_id, não do retorno do FB.login em si.
type EmbeddedSignupMessage = {
  type?: string;
  event?: "FINISH" | "CANCEL" | "ERROR";
  data?: { waba_id?: string; phone_number_id?: string };
};

// Conecta um número novo direto pela Meta (Tech Provider/Embedded Signup) — sem QR code e sem API key
// digitada à mão, diferente de Evolution/360dialog. O cliente loga na própria conta dele num popup da
// Meta, autoriza a AutomaX a gerenciar o WhatsApp Business dele, e a Meta devolve o waba_id/phone_number_id
// via postMessage. Precisa de NEXT_PUBLIC_META_APP_ID e NEXT_PUBLIC_META_CONFIG_ID configurados (ver
// Configurações > Embedded Signup no App Dashboard da Meta).
export function MetacloudConnect({ department, onConnected }: { department: string; onConnected?: () => void }) {
  const [sdkReady, setSdkReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const codeRef = useRef<string | null>(null);

  const appId = process.env.NEXT_PUBLIC_META_APP_ID;
  const configId = process.env.NEXT_PUBLIC_META_CONFIG_ID;

  // Inicializa via onReady do <Script> em vez de window.fbAsyncInit de propósito — fbAsyncInit é o
  // padrão "clássico" do SDK, mas depende de definir esse global ANTES do script carregar; com
  // next/script (injeta o <script> de forma assíncrona, fora da ordem normal de render), dava pra
  // esse efeito rodar depois do script já ter carregado e chamado fbAsyncInit — aí ele nunca mais
  // dispara, sdkReady fica false pra sempre e o botão "Conectar" fica desabilitado (sem avisar por
  // quê, só parece "não faz nada" ao clicar). onReady do next/script dispara certo mesmo se o script
  // já tiver carregado antes (troca de página/remount), o que resolve os dois casos.
  function handleSdkLoad() {
    window.FB?.init({ appId: appId || "", xfbml: false, version: "v21.0" });
    setSdkReady(true);
  }

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== "https://www.facebook.com" && event.origin !== "https://web.facebook.com") return;
      let payload: EmbeddedSignupMessage;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      if (payload.type !== "WA_EMBEDDED_SIGNUP") return;

      if (payload.event === "FINISH" && payload.data?.waba_id && payload.data?.phone_number_id) {
        const code = codeRef.current;
        if (!code) {
          setError("Não recebemos o código de autorização da Meta — tenta conectar de novo.");
          return;
        }
        const { waba_id: wabaId, phone_number_id: phoneNumberId } = payload.data;
        startTransition(async () => {
          const result = await connectMetaCloudInstance(wabaId, phoneNumberId, code, department);
          if (result.error) setError(result.error);
          else onConnected?.();
        });
      } else if (payload.event === "CANCEL") {
        setError("Conexão cancelada.");
      } else if (payload.event === "ERROR") {
        setError("A Meta retornou um erro durante a conexão — tenta de novo.");
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [department, onConnected]);

  function handleClick() {
    setError(null);
    codeRef.current = null;
    if (!window.FB || !configId) {
      setError("Embedded Signup não está configurado (faltam NEXT_PUBLIC_META_APP_ID/NEXT_PUBLIC_META_CONFIG_ID).");
      return;
    }
    window.FB.login(
      (response) => {
        // FB.login com response_type "code" devolve o code aqui — o waba_id/phone_number_id chegam
        // depois, via postMessage (handleMessage acima). Guarda o code pra usar quando o postMessage vier.
        if (response.authResponse?.code) codeRef.current = response.authResponse.code;
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {}, featureType: "", sessionInfoVersion: "3" },
      }
    );
  }

  if (!appId || !configId) {
    return (
      <p className="text-xs text-warning-text bg-warning-soft border border-warning-text/20 rounded-md p-3">
        Embedded Signup ainda não configurado nessa instalação — falta NEXT_PUBLIC_META_APP_ID e/ou
        NEXT_PUBLIC_META_CONFIG_ID nas variáveis de ambiente.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* onReady (não onLoad) de propósito — dispara tanto no primeiro carregamento quanto em
          remounts com o script já carregado (troca de workspace, reabrir o formulário), diferente de
          onLoad que só dispara 1x na vida da página. */}
      <Script src="https://connect.facebook.net/en_US/sdk.js" strategy="afterInteractive" onReady={handleSdkLoad} />
      <button
        type="button"
        onClick={handleClick}
        disabled={!sdkReady || pending}
        className="bg-primary-strong text-white text-sm font-bold px-4 py-2.5 rounded-md w-fit cursor-pointer disabled:opacity-60"
      >
        {pending ? "Conectando…" : sdkReady ? "Conectar via Meta" : "Carregando…"}
      </button>
      {error && <p className="text-sm text-danger font-medium">{error}</p>}
    </div>
  );
}
