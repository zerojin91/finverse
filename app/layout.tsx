import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
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
  title: "FINVERSE | 시장 인사이트와 마이 금융 트윈",
  description:
    "시장 환경을 이해하고 조건을 시뮬레이션한 뒤 나의 금융 목표에 연결하는 AI 금융 판단 서비스",
  openGraph: {
    title: "FINVERSE | 시장을 이해하고, 나에게 적용하다",
    description:
      "KOSPI 시장 인사이트부터 나의 금융 트윈까지 이어지는 AI 조건부 시뮬레이션",
    type: "website",
    locale: "ko_KR",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "FINVERSE 시장 인사이트와 마이 금융 트윈",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "FINVERSE | 시장을 이해하고, 나에게 적용하다",
    description: "시장 인사이트를 나의 금융 목표에 연결하는 AI 조건부 시뮬레이션",
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
