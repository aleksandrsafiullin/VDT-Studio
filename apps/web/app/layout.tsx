import type { Metadata } from "next";
import { ApiKeyStorage } from "@/components/vdt/api-key-storage";
import { CliConnection } from "@/components/vdt/cli-connection";
import { ProviderConnection } from "@/components/vdt/provider-connection";
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
      <body><ApiKeyStorage /><CliConnection /><ProviderConnection />{children}</body>
    </html>
  );
}
