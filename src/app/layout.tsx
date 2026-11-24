import type { Metadata, Viewport } from "next";
import { Pixelify_Sans, Press_Start_2P } from "next/font/google";
import "./globals.css";

const press = Press_Start_2P({ weight: "400", subsets: ["latin"], variable: "--font-press", display: "swap" });
const pixelify = Pixelify_Sans({ weight: ["400", "500", "600"], subsets: ["latin"], variable: "--font-pixelify", display: "swap" });

export const metadata: Metadata = {
  title: "Ocean Dive",
  description: "How deep does your ocean knowledge go? A classroom dive into ocean acidification.",
  robots: { index: false, follow: false },
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1f86d1",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${press.variable} ${pixelify.variable}`}>
      <body>{children}</body>
    </html>
  );
}
