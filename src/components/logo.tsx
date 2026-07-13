export function Logo({
  iconOnly = false,
  size = 30,
}: {
  iconOnly?: boolean;
  size?: number;
}) {
  return (
    <div className="brand" aria-label="LP Autopilot">
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        role="img"
        aria-hidden="true"
      >
        <path
          d="M6.5 5.5H3v21h3.5M25.5 5.5H29v21h-3.5"
          fill="none"
          stroke="#00d632"
          strokeWidth="2"
          strokeLinecap="square"
        />
        <path
          d="M8 21.5c3.7 0 4.7-11 8.6-11 2.8 0 3.9 5.8 7.4 5.8"
          fill="none"
          stroke="#f2f5f3"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path d="M16.8 9.2 24 6.5l-2.2 7.2-2-2.4-3 2Z" fill="#00d632" />
      </svg>
      {!iconOnly && (
        <div className="brand-copy">
          <div className="brand-name">LP AUTOPILOT</div>
          <div className="brand-sub">Liquidity in motion</div>
        </div>
      )}
    </div>
  );
}
