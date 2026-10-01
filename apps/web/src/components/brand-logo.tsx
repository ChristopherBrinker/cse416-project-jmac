import { cn } from "@cse416-project-jmac/ui/lib/utils";
import Image from "next/image";

export const PRODUCT_NAME = "Private AI Benchmark";

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
      {/* The mark is drawn in near-black, so it keeps a light tile in dark mode. */}
      <span
        className={cn(
          "ring-foreground/10 flex shrink-0 items-center justify-center bg-white ring-1",
          size === "sm" ? "size-8" : "size-12"
        )}
      >
        <Image
          src={LOGO_SRC}
          alt={showName ? "" : PRODUCT_NAME}
          width={LOGO_WIDTH}
          height={LOGO_HEIGHT}
          className={size === "sm" ? "h-5 w-auto" : "h-8 w-auto"}
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
