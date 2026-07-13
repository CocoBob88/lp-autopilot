"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletCards } from "lucide-react";
import { compactAddress } from "@/src/domain/format";
import { Logo } from "./logo";
import { useWallet } from "./wallet-provider";

const navigation = [
  ["/", "Pools"],
  ["/positions", "My positions"],
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const wallet = useWallet();
  const pathname = usePathname();
  return (
    <div className="app-grid public-shell dense-shell">
      <header className="app-header">
        <Link href="/" aria-label="LP Autopilot home">
          <Logo />
        </Link>
        <nav className="desktop-header-nav" aria-label="Primary navigation">
          {navigation.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className={
                (href === "/" ? pathname === "/" : pathname.startsWith(href))
                  ? "active"
                  : ""
              }
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="header-actions">
          <button
            className="button wallet-button primary"
            onClick={() =>
              wallet.address ? wallet.disconnect() : void wallet.connect()
            }
            disabled={wallet.busy}
          >
            <WalletCards size={14} />
            {wallet.busy
              ? "Connecting…"
              : wallet.address
                ? compactAddress(wallet.address)
                : "Connect wallet"}
          </button>
        </div>
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}
