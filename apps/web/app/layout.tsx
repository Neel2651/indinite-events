import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/700.css";
import "@fontsource/poppins/800.css";
import "@fontsource-variable/inter";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: { default: "Indinite Events", template: "%s | Indinite Events" },
  description: "Book passes for Navratri garba nights and other events across the UK.",
};

export const viewport: Viewport = { themeColor: "#0a0e1f" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="min-h-dvh flex flex-col">
        <header className="border-b border-border bg-background">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
            <Link href="/" className="font-display text-xl font-bold tracking-tight text-brand-orange">
              INDINITE <span className="font-sans font-normal text-muted-foreground">events</span>
            </Link>
            <Link href="/orders/lookup" className="text-sm font-semibold text-brand-orange-strong hover:underline">
              Find my tickets
            </Link>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="dark bg-background text-muted-foreground">
          <div className="mx-auto max-w-6xl px-5 py-10 text-sm">
            <p>
              Tickets sold by Indinite on behalf of event organisers. Payments processed securely by Stripe.
            </p>
            <p className="mt-2">© {new Date().getFullYear()} Indinite</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
