import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { Nav } from "@/components/Nav";
import "./globals.css";

const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Agent Shop",
  description: "Lowest prices from trusted stores, honest resale pricing, and deals with real sources.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={manrope.variable}>
      <body className="min-h-dvh font-sans antialiased">
        <Nav />
        <main className="relative z-10 mx-auto w-full max-w-5xl px-4 pb-24 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
