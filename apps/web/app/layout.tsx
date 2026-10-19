import type { Metadata } from "next";
import { ApiKeyStorage } from "@/components/vdt/api-key-storage";
import "./globals.css";
import "@xyflow/react/dist/style.css";

export const metadata: Metadata = {
  title: "VDT Studio",
  description: "AI-first Value Driver Tree workspace for calculable KPI driver models.",
  icons: {
    icon: "/favicon.svg"
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><ApiKeyStorage />{children}</body>
    </html>
  );
}
