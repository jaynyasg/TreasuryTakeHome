import type { Metadata } from "next";
import { Inter_Tight } from "next/font/google";
import "./globals.css";

export const metadata: Metadata = {
  title: "TTB Label Verify",
  description: "AI-powered alcohol label verification against COLA applications",
};

const interTight = Inter_Tight({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-inter-tight",
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={interTight.variable}>
      <body className={interTight.className}>{children}</body>
    </html>
  );
}
