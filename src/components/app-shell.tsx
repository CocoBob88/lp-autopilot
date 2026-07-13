"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BriefcaseBusiness, Compass, WalletCards } from "lucide-react";
import { compactAddress } from "@/src/domain/format";
import { Logo } from "./logo";
import { useWallet } from "./wallet-provider";

const navigation = [
  ["/", "Discover", Compass],
  ["/positions", "My positions", BriefcaseBusiness],
] as const;

function NavLink({
  href,
  label,
  Icon,
}: {
  href: string;
  label: string;
  Icon: typeof Compass;
}) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
  return (
    <Link className={`nav-link ${active ? "active" : ""}`} href={href}>
      <Icon size={16} strokeWidth={1.7} />
      <span>{label}</span>
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const wallet = useWallet();
  const pathname = usePathname();
  return (
    <div className="app-grid public-shell">
      <header className="app-header">
        <Link href="/" aria-label="LP Autopilot home">
          <Logo />
        </Link>
        <nav className="desktop-header-nav" aria-label="Primary navigation">
          {navigation.slice(0, 3).map(([href, label]) => (
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
      <aside className="app-sidebar">
        <div className="nav-group-label">Explore</div>
        {navigation.map(([href, label, Icon]) => (
          <NavLink key={href} href={href} label={label} Icon={Icon} />
        ))}
        <div className="sidebar-disclaimer">
          Independent analytics and LP tooling for Robinhood Chain. Estimates
          are not guaranteed returns.
        </div>
      </aside>
      <main className="app-main">{children}</main>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {navigation.slice(0, 5).map(([href, label, Icon]) => (
          <Link
            key={href}
            href={href}
            className={
              (href === "/" ? pathname === "/" : pathname.startsWith(href))
                ? "active"
                : ""
            }
          >
            <Icon size={18} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
