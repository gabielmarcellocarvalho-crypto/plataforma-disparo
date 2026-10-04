// Chave pra juntar empresas com grafia diferente: "V4 Carvalho", "v4 carvalho Ltda" e "V4 CARVALHO ME"
// viram a mesma empresa. Ignora maiúsculas, acento, pontuação e sufixo jurídico.
const SUFIXOS = new Set(["ltda", "me", "epp", "eireli", "sa", "s", "a", "cia", "ltd", "limitada"]);

export function companyKey(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return base
    .split(" ")
    .filter((w) => w && !SUFIXOS.has(w))
    .join(" ");
}
