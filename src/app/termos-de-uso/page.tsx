import type { Metadata } from "next";
import { LegalPage, Secao } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Termos de Uso — AutomaX",
  description: "Condições de uso da plataforma AutomaX de automação de atendimento e disparo de mensagens.",
};

export default function TermosDeUsoPage() {
  return (
    <LegalPage titulo="Termos de Uso" atualizadoEm="10 de agosto de 2026">
      <Secao titulo="1. Aceite e definições">
        <p>
          Estes Termos de Uso regem a utilização da plataforma AutomaX, operada por{" "}
          <strong className="text-text">CARVALHO ASSESSORIA DE MARKETING LTDA</strong>, CNPJ{" "}
          <strong className="text-text">48.885.778/0001-51</strong> ("AutomaX", "nós"). Ao contratar ou usar a plataforma,
          a empresa contratante ("Cliente") concorda com estes termos. "Usuário final" é qualquer pessoa que troca
          mensagens com o Cliente através da plataforma.
        </p>
      </Secao>

      <Secao titulo="2. O que é o serviço">
        <p>
          O AutomaX é um software (SaaS) que permite ao Cliente enviar e receber mensagens via WhatsApp e e-mail com seus
          próprios contatos, organizar essas conversas em um funil (CRM) e, opcionalmente, automatizar respostas usando
          inteligência artificial configurada pelo próprio Cliente.
        </p>
      </Secao>

      <Secao titulo="3. Responsabilidades do Cliente">
        <ul className="list-disc pl-5 flex flex-col gap-1.5">
          <li>Só enviar mensagens a contatos que já deram consentimento prévio para esse contato, conforme a LGPD e as políticas do WhatsApp Business.</li>
          <li>Não usar a plataforma para spam, conteúdo ilegal, discurso de ódio, fraude ou qualquer prática vedada pelas políticas comerciais da Meta/WhatsApp.</li>
          <li>Manter a veracidade das informações configuradas no agente de IA e assumir a responsabilidade pelo conteúdo comercial enviado aos seus contatos.</li>
          <li>Manter a confidencialidade das credenciais de acesso da sua equipe.</li>
        </ul>
      </Secao>

      <Secao titulo="4. Inteligência artificial">
        <p>
          Quando ativado pelo Cliente, o AutomaX usa modelos de IA de terceiros (Anthropic e, para transcrição de áudio,
          OpenAI) para gerar respostas automáticas. Essas respostas são geradas com base nas instruções e informações que o
          próprio Cliente configura, e podem conter erros — o Cliente é responsável por revisar e ajustar a configuração do
          agente e por supervisionar o atendimento prestado em seu nome.
        </p>
      </Secao>

      <Secao titulo="5. Planos e pagamento">
        <p>
          O uso da plataforma é cobrado conforme o plano contratado com a agência (implementação e/ou mensalidade). Custos
          de envio de mensagens cobrados diretamente pela Meta/WhatsApp Business Platform, quando aplicável, são de
          responsabilidade do Cliente e cobrados separadamente pela própria Meta.
        </p>
      </Secao>

      <Secao titulo="6. Disponibilidade do serviço">
        <p>
          Fazemos esforços razoáveis para manter a plataforma disponível, mas não garantimos operação ininterrupta:
          manutenções, falhas de fornecedores terceiros (Meta, Supabase, Vercel, provedores de IA) ou eventos fora do nosso
          controle podem causar indisponibilidade temporária.
        </p>
      </Secao>

      <Secao titulo="7. Suspensão e encerramento">
        <p>
          Podemos suspender ou encerrar o acesso de um Cliente que violar estes termos, as políticas da Meta/WhatsApp ou a
          legislação aplicável. O Cliente pode encerrar o uso da plataforma a qualquer momento, respeitando as condições
          comerciais acordadas separadamente.
        </p>
      </Secao>

      <Secao titulo="8. Limitação de responsabilidade">
        <p>
          O AutomaX não se responsabiliza por decisões comerciais tomadas com base nas respostas geradas por IA, nem por
          bloqueios, tarifas ou penalidades aplicadas pela Meta/WhatsApp em decorrência do uso indevido da plataforma pelo
          Cliente.
        </p>
      </Secao>

      <Secao titulo="9. Lei aplicável">
        <p>
          Estes termos são regidos pelas leis brasileiras, incluindo a Lei Geral de Proteção de Dados (Lei 13.709/2018) e o
          Marco Civil da Internet (Lei 12.965/2014). Fica eleito o foro do domicílio da CARVALHO ASSESSORIA DE MARKETING
          LTDA para dirimir eventuais conflitos.
        </p>
      </Secao>

      <Secao titulo="10. Contato">
        <p>
          Dúvidas sobre estes termos: <strong className="text-text">gabrielcarvalho@v4company.com</strong>. Veja também
          nossa{" "}
          <a href="/politica-privacidade" className="text-primary-strong font-semibold hover:underline">
            Política de Privacidade
          </a>
          .
        </p>
      </Secao>
    </LegalPage>
  );
}
