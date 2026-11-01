import { Link } from "react-router";
import type { ListingView } from "@/api/types";
import { chanceText, percentSold } from "@/domain/chance";
import { formatNaira } from "@/domain/money";
import { salePriceKobo } from "@/domain/orders";
import { isBoosted } from "@/domain/boosts";
import { Countdown } from "./Countdown";
import { SaveButton } from "./SaveButton";
import {
  CheckIcon,
  FlameIcon,
  HandshakeIcon,
  MapPinIcon,
  TicketIcon,
} from "./icons";
import { Badge, ProductImage, ProgressBar, cx } from "./ui";

export function isAlmostGone(l: ListingView) {
  return (
    l.status === "live" &&
    l.ticketCount > 0 &&
    l.ticketsSold / l.ticketCount >= 0.85
  );
}

/** "60×" — how many times cheaper a ticket is than the item. */
export function valueMultiple(
  l: Pick<ListingView, "priceKobo" | "buyerTicketPriceKobo">,
) {
  return Math.round(l.priceKobo / l.buyerTicketPriceKobo);
}

/** One of a live draw's four numbers: never wraps, even on the narrowest phone card. */
function PlainNumber({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col-reverse whitespace-nowrap">
      <dt className="text-[11px] leading-tight text-subtle">{label}</dt>
      <dd
        className={cx(
          "text-[13px] leading-tight font-extrabold tabular-nums sm:text-sm",
          className,
        )}
      >
        {children}
      </dd>
    </div>
  );
}

/** `compact`: for the scrolling rows, where cards are narrower than in a grid. */
export function ListingCard({
  listing: l,
  className,
  style,
  compact,
}: {
  listing: ListingView;
  className?: string;
  style?: React.CSSProperties;
  compact?: boolean;
}) {
  const hot = isAlmostGone(l);
  const pct = percentSold(l.ticketsSold, l.ticketCount);
  const mine = l.myNumbers.length;
  const price = salePriceKobo(l);
  // Fixed-price cards: regular products, and draws that ended unsold.
  const forSale = l.kind === "product" || price !== null;

  return (
    <div
      style={style}
      className={cx(
        "group relative flex animate-fade-up flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-card transition duration-200 hover:-translate-y-1 hover:border-line-strong hover:shadow-lift",
        className,
      )}
    >
      <Link
        to={`/listings/${l.id}`}
        className="flex flex-1 flex-col text-ink no-underline"
      >
        <div className="relative p-2 pb-0">
          <ProductImage
            category={l.category}
            src={l.images[0]}
            alt={l.title}
            className={compact ? "h-36 sm:h-40" : "h-44"}
            imgClassName="transition-transform duration-500 ease-out group-hover:scale-105"
          />
          {l.images.length > 1 ? (
            <span
              className="absolute bottom-2 left-4 flex gap-1"
              aria-hidden="true"
            >
              {l.images.map((src, i) => (
                <span
                  key={src}
                  className={cx(
                    "h-1.5 rounded-full",
                    i === 0 ? "w-4 bg-ink/70" : "w-1.5 bg-ink/25",
                  )}
                />
              ))}
            </span>
          ) : null}
          {/* Leaves the corner clear for the heart. */}
          <div className="absolute top-4 right-11 left-2.5 flex flex-wrap items-start justify-between gap-1.5 sm:left-4">
            <span className="flex flex-wrap gap-1.5">
              {/* <Badge tone="neutral" className="bg-surface/85 backdrop-blur">
                {l.category}
              </Badge> */}
              {isBoosted(l, Date.now()) ? (
                <Badge tone="ticket" className="shadow-card">
                  <HandshakeIcon size={12} /> Sponsored
                </Badge>
              ) : null}
            </span>
            <div className="flex flex-wrap justify-start gap-1.5 sm:justify-end">
              {hot ? (
                <Badge tone="hot" className="whitespace-nowrap shadow-card">
                  <FlameIcon size={12} className="max-[360px]:hidden" /> ALMOST
                  GONE
                </Badge>
              ) : null}
              {mine > 0 && l.status === "live" ? (
                <Badge tone="ticket" className="shadow-card">
                  <TicketIcon size={12} /> {mine} YOURS
                </Badge>
              ) : null}
              {l.status === "drawn" ? <Badge tone="neutral">DRAWN</Badge> : null}
              {l.status === "sold_out" ? <Badge tone="ticket">SOLD OUT</Badge> : null}
              {l.status === "sold" ? (
                <Badge tone="hot">SOLD OUT</Badge>
              ) : forSale ? (
                <Badge tone="sky">BUY NOW</Badge>
              ) : null}
            </div>
          </div>
          {forSale ? null : (
            <span className="absolute right-4 bottom-2 rounded-full bg-ink px-2.5 py-1 text-[11px] font-extrabold text-ground shadow-card">
              {valueMultiple(l)}× cheaper
            </span>
          )}
        </div>

        <div
          className={cx(
            "flex flex-1 flex-col gap-3",
            "p-3",
          )}
        >
          <div className="flex flex-col gap-1">
            <span
              className={cx(
                "leading-tight font-extrabold",
                compact
                  ? "line-clamp-2 text-[15px]"
                  : "text-[15px]",
              )}
            >
              {l.title}
            </span>
            <span className="flex items-center gap-1 truncate text-xs text-subtle">
              {l.merchant.verified ? (
                <CheckIcon size={13} className="shrink-0 text-brand" />
              ) : null}
              {l.merchant.name}
              <span aria-hidden="true">·</span>
              <MapPinIcon size={12} className="shrink-0" /> {l.merchant.area}
            </span>
          </div>

          {!forSale && (
            <div className="flex flex-col gap-1.5">
              {l.status === "live" ? null : (
                <div className="flex justify-between text-xs font-semibold">
                  <span className={hot ? "text-hot-ink" : "text-muted"}>
                    {pct}% sold
                  </span>
                  <span className="text-subtle">
                    {l.status === "sold_out"
                      ? "Winner coming soon"
                      : "Draw complete"}
                  </span>
                </div>
              )}
              <ProgressBar
                value={l.ticketsSold}
                max={l.ticketCount}
                hot={hot}
                label={`${l.ticketsSold} of ${l.ticketCount} tickets sold`}
              />
            </div>
          )}

          {!forSale && l.status === "live" ? (
            <div className="mt-auto flex flex-col gap-1.5 border-t border-dashed border-line pt-3">
              <span className="text-[11px] text-subtle line-through decoration-subtle/50">
                Worth {formatNaira(l.priceKobo)}
              </span>
              <dl className="grid grid-cols-[auto_auto] justify-between gap-x-2 gap-y-1.5">
                <PlainNumber label="per ticket">
                  {formatNaira(l.buyerTicketPriceKobo)}
                </PlainNumber>
                <PlainNumber label="chance">
                  {chanceText(1, l.ticketCount)}
                </PlainNumber>
                <PlainNumber label="sold" className={hot ? "text-hot-ink" : undefined}>
                  {pct}%
                </PlainNumber>
                <PlainNumber label="left">
                  <Countdown
                    closesAt={l.closesAt}
                    icon={false}
                    closingText="00:00:00"
                  />
                </PlainNumber>
              </dl>
            </div>
          ) : (
            <div className="mt-auto flex flex-wrap items-end justify-between gap-2 border-t border-dashed border-line pt-3">
              {forSale ? (
                <div className="flex flex-col">
                  <span className="text-[11px] text-subtle">
                    {l.status === "sold" ? "Sold for" : "Buy now"}
                  </span>
                  <span className="text-lg leading-tight font-extrabold">
                    {formatNaira(price ?? l.fallbackPriceKobo ?? l.priceKobo)}
                  </span>
                </div>
              ) : (
                <div className="flex flex-col">
                  <span className="text-[11px] text-subtle line-through decoration-subtle/50">
                    Worth {formatNaira(l.priceKobo)}
                  </span>
                  <span className="text-lg leading-tight font-extrabold">
                    {formatNaira(l.buyerTicketPriceKobo)}
                    <span className="text-xs font-semibold text-subtle">
                      {" "}
                      / ticket
                    </span>
                  </span>
                </div>
              )}
              {l.status === "sold_out" && l.drawAt ? (
                <Countdown
                  closesAt={l.drawAt}
                  className="rounded-full bg-sunken px-2.5 py-1 text-xs font-bold"
                />
              ) : null}
            </div>
          )}
        </div>
      </Link>
      {/* Beside the link, not in it: a button inside a link isn't valid and would open the listing. */}
      <SaveButton
        listingId={l.id}
        title={l.title}
        onImage
        className="absolute top-1 right-1"
      />
    </div>
  );
}
