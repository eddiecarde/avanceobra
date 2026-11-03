import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppShell } from "@/components/AppShell";
import { PwaRegister } from "@/components/PwaRegister";
import { SessionProvider } from "@/lib/session";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AvanceObra · Administración",
  description: "Avance de obra desde el campo, aun sin señal, con tableros, informes y decisiones.",
  applicationName: "AvanceObra",
  // iPhone: al agregarla a la pantalla de inicio abre como app, con su ícono y sin la barra de Safari
  appleWebApp: { capable: true, title: "AvanceObra", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#1f3a5f",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <SessionProvider>
          <AppShell>{children}</AppShell>
          <PwaRegister />
        </SessionProvider>
      </body>
    </html>
  );
}
