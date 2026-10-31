import type { Metadata } from "next";
import { Michroma, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

// Fonte do nome na marca (parecida com o letreiro da logo: larga, quadrada e fina).
const michroma = Michroma({
  variable: "--font-brand",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "AutomaX",
  description: "Disparo de WhatsApp e e-mail em massa, multi-cliente.",
  metadataBase: new URL("https://automax.v4carvalho.com.br"),
  openGraph: {
    title: "AutomaX",
    description: "Disparo de WhatsApp e e-mail em massa, multi-cliente.",
    url: "https://automax.v4carvalho.com.br",
    siteName: "AutomaX",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
    locale: "pt_BR",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className={`${plusJakarta.variable} ${michroma.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-bg text-text">{children}</body>
    </html>
  );
}
