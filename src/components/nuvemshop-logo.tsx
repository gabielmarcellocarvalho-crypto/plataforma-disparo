// Logo da Nuvemshop (arquivo em public/brand). Usada no card de integração e na página da loja.
// A imagem é 4:3, então `size` define a largura e a altura acompanha.
export function NuvemshopLogo({ size = 16, className }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/brand/nuvemshop.png" alt="" width={size} height={Math.round((size * 3) / 4)} className={className} aria-hidden />
  );
}
