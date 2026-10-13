// som-portal-v2/src/lib/cn.ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * cn — classnames helper. clsx handles conditionals; tailwind-merge dedupes
 * conflicting Tailwind utilities so overrides are deterministic.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
