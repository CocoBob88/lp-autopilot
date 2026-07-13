import type { Metadata } from "next";
import "./globals.css";
import { WalletProvider } from "@/src/components/wallet-provider";
import { AppShell } from "@/src/components/app-shell";

export async function generateMetadata(): Promise<Metadata> {
  const origin =
    process.env.APP_ORIGIN || "https://lp-autopilot-rose.vercel.app";
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
