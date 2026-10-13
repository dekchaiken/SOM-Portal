// som-portal-v2/src/icons/Icon.tsx
import * as React from "react";
import { cn } from "@/ui/cn";
import { ICONS, type IconName } from "./icon-names";

export interface IconProps extends React.SVGAttributes<SVGSVGElement> {
  name: IconName;
  size?: number;
  strokeWidth?: number;
}

/**
 * Icon — wraps Lucide icons with a stable `name` prop so swapping libraries
 * later is a single-file change. `aria-hidden` by default; pass `aria-label`
 * to opt into a labeled icon.
 */
export const Icon = React.forwardRef<SVGSVGElement, IconProps>(function Icon(
  { name, size = 16, strokeWidth = 1.75, className, "aria-label": label, ...rest },
  ref,
) {
  const Component = ICONS[name];
  if (!Component) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn(`[Icon] unknown name: ${name}`);
    }
    return null;
  }
  return (
    <Component
      ref={ref}
      size={size}
      strokeWidth={strokeWidth}
      className={cn("inline-block shrink-0 text-current", className)}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      {...rest}
    />
  );
});
