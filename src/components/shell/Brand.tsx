import Image from "next/image";

/**
 * The Gantry CRM logo. The artwork has black lettering, so it always sits on a light "plate":
 * that keeps it readable on the navy sidebar and in the dark theme without recolouring the brand.
 */
export function Brand({ alt = "Gantry CRM", plate = true }: { alt?: string; plate?: boolean }) {
  return (
    <span className={plate ? "brand-plate" : undefined}>
      <Image
        src="/brand/gantry-logo.png"
        alt={alt}
        width={900}
        height={283}
        priority
        unoptimized
        className="brand-logo"
      />
    </span>
  );
}
