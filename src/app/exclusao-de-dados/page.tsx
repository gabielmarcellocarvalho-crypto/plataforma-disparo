import type { Metadata } from "next";
import { LegalPage, Secao } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Exclusão de Dados — AutomaX",
  description: "Como solicitar a exclusão dos seus dados pessoais tratados pela plataforma AutomaX.",
};

export default function ExclusaoDeDadosPage() {
  return (
    <LegalPage titulo="Exclusão de Dados" atualizadoEm="10 de agosto de 2026">
      <Secao titulo="Quem pode solicitar">
        <p>Esta página serve para dois grupos de pessoas diferentes:</p>
        <ul className="list-disc pl-5 flex flex-col gap-1.5">
          <li>
            <strong className="text-text">Empresa Cliente</strong> (dono da conta AutomaX): pode solicitar a exclusão dos
            dados da sua conta e da sua conexão com o WhatsApp Business a qualquer momento.
          </li>
          <li>
            <strong className="text-text">Usuário final</strong> (pessoa que conversou pelo WhatsApp com uma empresa que
            usa o AutomaX): pode solicitar a exclusão dos seus dados pessoais (nome, telefone, histórico de mensagens)
            armazenados na plataforma.
          </li>
        </ul>
      </Secao>

      <Secao titulo="Como solicitar">
        <p>
          Envie um e-mail para <strong className="text-text">gabrielcarvalho@v4company.com</strong> com o assunto
          "Exclusão de dados", informando:
        </p>
        <ul className="list-disc pl-5 flex flex-col gap-1.5">
          <li>Se você é a Empresa Cliente ou um Usuário final;</li>
          <li>O número de telefone (com DDD) ou e-mail usado na conversa/conta;</li>
          <li>Se for Usuário final, o nome da empresa com quem você conversou pelo WhatsApp (para localizarmos seus dados mais rápido).</li>
        </ul>
      </Secao>

      <Secao titulo="O que acontece depois">
        <p>
          Confirmamos o recebimento do pedido e, após verificar a identidade do solicitante, excluímos os dados pessoais
          correspondentes (dados de contato e histórico de mensagens) do banco de dados da plataforma em até 15 dias
          úteis, ressalvado o que precisamos manter por obrigação legal (ex.: registros fiscais) ou enquanto durar uma
          obrigação contratual em andamento. Usuários finais também podem pedir a exclusão diretamente à empresa com quem
          conversaram, já que ela é a responsável pelo relacionamento comercial com esse contato.
        </p>
      </Secao>

      <Secao titulo="Exclusão de dados obtidos via Meta">
        <p>
          Se você concluiu o processo de conexão do WhatsApp Business (Embedded Signup) usando login da Meta, também pode
          revogar o acesso do AutomaX à sua conta a qualquer momento em Configurações do Facebook → Aplicativos e sites, o
          que interrompe o compartilhamento de novos dados imediatamente; a exclusão dos dados já armazenados segue o
          mesmo processo descrito acima.
        </p>
      </Secao>
    </LegalPage>
  );
}
