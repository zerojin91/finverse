import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tailscale Funnel 로 공개하면 브라우저가 보내는 Host 가 localhost 가 아니다.
  // Next 개발 서버는 그 경우 개발용 리소스 요청을 기본 차단하므로 호스트를 허용한다.
  allowedDevOrigins: ["finverse-collector.taila68873.ts.net"],
};

export default nextConfig;
