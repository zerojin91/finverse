import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "FINVERSE | AI 금융 디지털 트윈",
  description:
    "시장 충격 속 선택을 내 자산과 생활 목표에 연결해 연습하는 AI 금융 디지털 트윈 서비스",
  openGraph: {
    title: "FINVERSE | 오늘 시장을 내 미래로",
    description:
      "시장 충격 속 선택을 내 자산과 생활 목표에 연결해 연습하는 AI 금융 디지털 트윈",
    type: "website",
    locale: "ko_KR",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "FINVERSE AI 금융 디지털 트윈",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "FINVERSE | 오늘 시장을 내 미래로",
    description: "시장 충격 속 선택을 연습하는 AI 금융 디지털 트윈",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
