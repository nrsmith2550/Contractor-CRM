/** The Clinch mark: two interlocking links. A stand-in until the final logo file is supplied. */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <rect x="3" y="8" width="23" height="23" rx="8" fill="#ff7a45" />
      <rect x="14" y="10" width="23" height="23" rx="8" fill="#e5484d" fillOpacity="0.92" />
    </svg>
  );
}

export function Brand() {
  return (
    <span className="crm-brand-lockup">
      <BrandMark />
      <span className="crm-brand-name">Clinch</span>
      <span className="crm-brand-sub">CRM</span>
    </span>
  );
}
