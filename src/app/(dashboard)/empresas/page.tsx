import { redirect } from "next/navigation";

// Empresas agora é uma visão dentro de Contatos.
export default function EmpresasPage() {
  redirect("/contatos?view=empresas");
}
