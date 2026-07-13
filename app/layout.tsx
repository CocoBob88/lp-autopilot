import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { WalletProvider } from "@/src/components/wallet-provider";
import { AppShell } from "@/src/components/app-shell";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ||
    requestHeaders.get("host") ||
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ||
    (host.startsWith("localhost") ? "http" : "https");
  const origin = process.env.APP_ORIGIN || `${protocol}://${host}`;
  return {
    metadataBase: new URL(origin),
    title: {
      default: "LP Autopilot — Find and model V3 farms",
      template: "%s · LP Autopilot",
    },
    description:
      "Scan Robinhood Chain V3 pools, compare live farm metrics, simulate concentrated ranges, and create liquidity positions from your wallet.",
    applicationName: "LP Autopilot",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      title: "LP Autopilot — Find the range before you fund it",
      description:
        "Live V3 farm discovery, range simulation, and wallet-assisted liquidity creation on Robinhood Chain.",
      type: "website",
      images: [{ url: "/og.png", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "LP Autopilot — Find the range before you fund it",
      description:
        "Live V3 farm discovery, range simulation, and wallet-assisted liquidity creation on Robinhood Chain.",
      images: ["/og.png"],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>
          <AppShell>{children}</AppShell>
        </WalletProvider>
      </body>
    </html>
  );
}
