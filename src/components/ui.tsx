import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { ApiError } from "@/api/types";
import type { Category } from "@/domain/types";
import { CATEGORY_STYLE } from "./category";
import { AlertIcon, InfoIcon, type IconComponent } from "./icons";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

type Variant =
  | "primary"
  | "ticket"
  | "outline"
  | "ghost"
  | "danger"
  | "soft"
  | "dark";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-brand text-on-brand shadow-glow hover:bg-brand-deep active:scale-[0.98] disabled:shadow-none cursor-pointer",
  ticket:
    "bg-ticket text-on-ticket shadow-card hover:brightness-105 active:scale-[0.98] cursor-pointer",
  outline:
    "border border-line-strong bg-surface text-ink hover:border-ink/40 hover:bg-sunken/60 active:scale-[0.98] cursor-pointer",
  ghost: "text-muted hover:bg-sunken hover:text-ink cursor-pointer ",
  danger:
    "border border-hot/30 bg-surface text-hot-ink hover:bg-hot-soft active:scale-[0.98] cursor-pointer",
  soft: "bg-brand-soft text-brand-ink hover:brightness-95 active:scale-[0.98] cursor-pointer",
  dark: "bg-ink text-ground hover:opacity-90 active:scale-[0.98] cursor-pointer",
};

const SIZES: Record<Size, string> = {
  lg: "min-h-13 px-6 text-base rounded-2xl",
  md: "min-h-11 px-4 text-sm rounded-xl",
  sm: "min-h-9 px-3 text-xs rounded-lg",
};

/** Shared button look, also used for links that act as buttons. */
export function buttonClass(
  variant: Variant = "primary",
  size: Size = "md",
  className?: string,
) {
  return cx(
    "inline-flex select-none items-center justify-center gap-2 font-bold no-underline transition duration-150 disabled:cursor-not-allowed disabled:opacity-50",
    SIZES[size],
    VARIANTS[variant],
    className,
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  loading,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}) {
  return (
    <button
      className={buttonClass(variant, size, className)}
      disabled={loading || rest.disabled}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

/** Square icon-only button. Always pass `aria-label`. */
export function IconButton({
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { "aria-label": string }) {
  return (
    <button
      className={cx(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-sunken hover:text-ink active:scale-95 disabled:opacity-40",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        "size-4 animate-spin rounded-full border-2 border-current border-r-transparent",
        className,
      )}
      aria-hidden="true"
    />
  );
}

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "rounded-3xl border border-line bg-surface shadow-card",
        className,
      )}
    >
      {children}
    </div>
  );
}

export type Tone = "brand" | "hot" | "ticket" | "neutral" | "sky" | "violet";
export const TONES: Record<Tone, string> = {
  brand: "bg-brand-soft text-brand-ink",
  hot: "bg-hot-soft text-hot-ink",
  ticket: "bg-ticket text-on-ticket",
  neutral: "bg-sunken text-muted",
  sky: "bg-sky-soft text-sky",
  violet: "bg-violet-soft text-violet",
};

export function Badge({
  tone = "brand",
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-extrabold tracking-wide",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function ProgressBar({
  value,
  max,
  hot,
  label,
  size = "md",
  className,
}: {
  value: number;
  max: number;
  hot?: boolean;
  label: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cx(
        "overflow-hidden rounded-full bg-sunken",
        size === "sm" ? "h-1.5" : size === "lg" ? "h-3.5" : "h-2.5",
        className,
      )}
    >
      <div
        className={cx(
          "relative h-full overflow-hidden rounded-full bg-linear-to-r transition-[width] duration-700 ease-out",
          hot ? "from-ticket to-hot" : "from-brand to-brand-deep",
        )}
        style={{ width: `${Math.max(pct, value > 0 ? 3 : 0)}%` }}
      >
        <span className="absolute inset-y-0 left-0 w-1/3 animate-shine bg-linear-to-r from-transparent via-white/40 to-transparent" />
      </div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cx(
        "animate-shimmer rounded-3xl bg-linear-to-r from-sunken via-line/60 to-sunken bg-[length:200%_100%]",
        className,
      )}
      aria-hidden="true"
    />
  );
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  return (
    <EmptyState
      icon={AlertIcon}
      tone="hot"
      title="Something went wrong"
      body={errorMessage(error)}
      action={
        onRetry ? (
          <Button variant="outline" onClick={onRetry}>
            Try again
          </Button>
        ) : null
      }
    />
  );
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  tone = "brand",
  className,
}: {
  icon: IconComponent;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex flex-col items-center gap-3 rounded-3xl border border-dashed border-line-strong bg-surface/60 px-6 py-12 text-center",
        className,
      )}
    >
      <span
        className={cx(
          "flex size-14 items-center justify-center rounded-2xl",
          TONES[tone],
        )}
      >
        <Icon size={26} />
      </span>
      <p className="font-display text-xl font-bold">{title}</p>
      {body ? <p className="max-w-sm text-sm text-muted">{body}</p> : null}
      {action}
    </div>
  );
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Please try again.";
}

export function PageTitle({
  children,
  sub,
  eyebrow,
  action,
}: {
  children: ReactNode;
  sub?: ReactNode;
  eyebrow?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 animate-fade-up">
      <div className="flex flex-col gap-1">
        {eyebrow ? (
          <span className="text-xs font-extrabold tracking-[0.14em] text-brand uppercase">
            {eyebrow}
          </span>
        ) : null}
        <h1 className="font-display text-3xl font-extrabold tracking-tight md:text-4xl">
          {children}
        </h1>
        {sub ? <p className="max-w-xl text-sm text-muted">{sub}</p> : null}
      </div>
      {action}
    </div>
  );
}

/**
 * A listing photo. Studio shots sit on a light tile and blend into it; scene
 * photos (cars) fill the frame. Without a photo, or if it fails to load, it
 * falls back to category artwork.
 */
export function ProductImage({
  category,
  src,
  alt,
  className,
  imgClassName,
  size = "md",
  fit,
  eager,
}: {
  category: Category;
  src?: string;
  alt?: string;
  className?: string;
  imgClassName?: string;
  size?: "sm" | "md" | "lg";
  fit?: "contain" | "cover";
  eager?: boolean;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);

  if (src && failed !== src) {
    const mode = fit ?? (category === "Cars" ? "cover" : "contain");
    return (
      <div
        className={cx(
          "relative overflow-hidden rounded-2xl bg-photo",
          className,
        )}
      >
        <img
          src={src}
          alt={alt ?? ""}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          onLoad={() => setLoaded(src)}
          onError={() => setFailed(src)}
          className={cx(
            "size-full transition duration-500",
            mode === "cover"
              ? "object-cover object-[50%_60%]"
              : cx(
                  "object-contain mix-blend-multiply",
                  size === "sm" ? "p-1" : size === "lg" ? "p-6 md:p-10" : "p-3",
                ),
            loaded === src ? "opacity-100" : "opacity-0",
            imgClassName,
          )}
        />
      </div>
    );
  }

  const s = CATEGORY_STYLE[category];
  const Icon = s.icon;
  return (
    <div
      className={cx(
        "relative flex items-center justify-center overflow-hidden rounded-2xl bg-linear-to-br",
        s.art,
        className,
      )}
      role="img"
      aria-label={`${category} photo placeholder`}
    >
      <span className="absolute -top-6 -right-6 size-28 rounded-full bg-surface/50" />
      <span className="absolute -bottom-10 -left-8 size-36 rounded-full bg-surface/40" />
      <Icon
        size={size === "lg" ? 112 : size === "sm" ? 36 : 64}
        strokeWidth={size === "lg" ? 1.2 : 1.5}
        className={cx(
          "relative drop-shadow-sm",
          s.glyph,
          size === "lg" && "animate-float",
        )}
      />
    </div>
  );
}

/** Accessible segmented control (a row of toggle buttons). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
  size = "md",
}: {
  options: { value: T; label: ReactNode; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cx("no-scrollbar inline-flex max-w-full gap-1 overflow-x-auto rounded-2xl bg-sunken p-1", className)}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cx(
              "flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 font-bold whitespace-nowrap transition",
              size === "sm" ? "min-h-9 text-xs" : "min-h-11 text-sm",
              active
                ? "bg-surface text-ink shadow-card"
                : "text-muted hover:text-ink",
            )}
          >
            {o.label}
            {o.count !== undefined ? (
              <span
                className={cx(
                  "rounded-full px-1.5 py-0.5 text-[10px]",
                  active ? "bg-brand text-on-brand" : "bg-line text-muted",
                )}
              >
                {o.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  tone = "brand",
  className,
}: {
  icon: IconComponent;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <Card className={cx("flex flex-col gap-3 p-4", className)}>
      <span
        className={cx(
          "flex size-10 items-center justify-center rounded-xl",
          TONES[tone],
        )}
      >
        <Icon size={20} />
      </span>
      <div className="flex flex-col">
        <span className="text-xs font-semibold text-subtle">{label}</span>
        <span className="font-display text-2xl font-extrabold tracking-tight">
          {value}
        </span>
        {hint ? <span className="text-xs text-subtle">{hint}</span> : null}
      </div>
    </Card>
  );
}

export function LiveDot({ className }: { className?: string }) {
  return (
    <span className={cx("relative flex size-2", className)} aria-hidden="true">
      <span className="absolute inline-flex size-full animate-ping-slow rounded-full bg-current opacity-60" />
      <span className="relative inline-flex size-2 rounded-full bg-current" />
    </span>
  );
}

/** Inline callout for tips, warnings and errors. */
export function Notice({
  tone = "brand",
  icon: Icon = InfoIcon,
  title,
  children,
  action,
  className,
}: {
  tone?: Tone;
  icon?: IconComponent;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const colours: Record<Tone, string> = {
    brand: "bg-brand-soft text-brand-ink",
    hot: "bg-hot-soft text-hot-ink",
    ticket: "bg-ticket-soft text-ticket-ink",
    neutral: "bg-sunken text-muted",
    sky: "bg-sky-soft text-sky",
    violet: "bg-violet-soft text-violet",
  };
  return (
    <div
      className={cx(
        "flex gap-3 rounded-2xl p-3.5 text-sm leading-snug [&_a]:text-current [&_a]:underline",
        colours[tone],
        className,
      )}
    >
      <Icon size={20} className="mt-px shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {title ? <strong>{title}</strong> : null}
        {children ? <div>{children}</div> : null}
        {action}
      </div>
    </div>
  );
}

/** Label + control + hint, for forms. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-bold">
        {label}
      </label>
      {children}
      {error ? (
        <span className="text-xs font-semibold text-hot-ink">{error}</span>
      ) : hint ? (
        <span className="text-xs text-subtle">{hint}</span>
      ) : null}
    </div>
  );
}

export const inputCls =
  "min-h-12 w-full rounded-xl border border-line-strong bg-ground px-3.5 text-sm text-ink transition placeholder:text-subtle/80 hover:border-ink/30 focus:border-brand focus:bg-surface focus:ring-4 focus:ring-brand/15 focus:outline-none";
