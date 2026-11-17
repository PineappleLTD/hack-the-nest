import type { Metadata, Viewport } from "next";
import { STARTED_SCRIPT } from "@/lib/started";
import "./globals.css";

export const metadata: Metadata = {
  title: "vendr",
  description: "Lowest prices from trusted stores, honest resale pricing, and deals with real sources.",
};

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // The head script sets data-started before paint, so the attribute is expected to differ on hydration.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: STARTED_SCRIPT }} />
      </head>
      <body className="min-h-dvh font-sans antialiased">
        <main className="relative z-10 mx-auto w-full max-w-5xl px-4 pt-(--page-top) pb-24 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
