// som-portal-v2/src/ui/shadcn/card.tsx
import * as React from "react";
import { cn } from "@/ui/cn";

/** Minimal Card stub — replaced by shadcn CLI output. */

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function Card({ className, ...rest }, ref) {
    return (
      <div
        ref={ref}
        className={cn("surface-card p-5", className)}
        {...rest}
      />
    );
  },
);

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardHeader({ className, ...rest }, ref) {
    return <div ref={ref} className={cn("mb-3 flex flex-col gap-1", className)} {...rest} />;
  },
);

export const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  function CardTitle({ className, ...rest }, ref) {
    return <h3 ref={ref} className={cn("text-base font-semibold", className)} {...rest} />;
  },
);

export const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  function CardDescription({ className, ...rest }, ref) {
    return <p ref={ref} className={cn("text-sm text-[var(--text-muted)]", className)} {...rest} />;
  },
);

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardContent({ className, ...rest }, ref) {
    return <div ref={ref} className={cn("flex flex-col gap-3", className)} {...rest} />;
  },
);

export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardFooter({ className, ...rest }, ref) {
    return (
      <div
        ref={ref}
        className={cn("mt-4 flex items-center justify-end gap-2", className)}
        {...rest}
      />
    );
  },
);
