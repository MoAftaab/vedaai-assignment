import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "VedaAI — Assessment Extraction & Answer Mapping",
  description:
    "Upload a question paper and a student answer sheet; VedaAI extracts questions, transcribes handwritten answers, maps them, and highlights the exact region on the sheet.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${jakarta.variable} h-full`}>
      <body className="min-h-full bg-canvas text-ink font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
