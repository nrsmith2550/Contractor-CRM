import Image from "next/image";

/**
 * The Clinch CRM logo. The artwork has black lettering, so it always sits on a light "plate":
 * that keeps it readable on the navy sidebar and in the dark theme without recolouring the brand.
 */
export function Brand({ alt = "Clinch CRM", plate = true }: { alt?: string; plate?: boolean }) {
  return (
    <span className={plate ? "brand-plate" : undefined}>
      <Image
        src="/brand/clinch-logo.png"
        alt={alt}
        width={900}
        height={272}
        priority
        unoptimized
        className="brand-logo"
      />
    </span>
  );
}
