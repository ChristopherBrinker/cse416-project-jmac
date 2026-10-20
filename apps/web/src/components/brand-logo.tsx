import { cn } from "@cse416-project-jmac/ui/lib/utils";
import Image from "next/image";

export const PRODUCT_NAME = "Private by JMAC";

const LOGO_SRC = "/private-ai-benchmarking-icon.svg";
const LOGO_WIDTH = 280;
const LOGO_HEIGHT = 355;

interface BrandLogoProps {
  className?: string;
  size?: "sm" | "lg";
  showName?: boolean;
}

export function BrandLogo({
  className,
  size = "sm",
  showName = true,
}: BrandLogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span
        className={cn(
          "flex shrink-0 items-center justify-center",
          size === "sm" ? "size-8" : "size-12"
        )}
      >
        <Image
          src={LOGO_SRC}
          alt={showName ? "" : PRODUCT_NAME}
          width={LOGO_WIDTH}
          height={LOGO_HEIGHT}
          className={cn(
            "dark:hue-rotate-180 dark:invert",
            size === "sm" ? "h-5 w-auto" : "h-8 w-auto"
          )}
          priority
        />
      </span>
      {showName ? (
        <span
          className={cn(
            "font-semibold tracking-tight whitespace-nowrap",
            size === "sm" ? "text-sm" : "text-xl"
          )}
        >
          {PRODUCT_NAME}
        </span>
      ) : null}
    </span>
  );
}
