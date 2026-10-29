import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useListings } from "@/api/hooks";
import type { ListingView } from "@/api/types";
import { withSponsoredFirst } from "@/domain/boosts";
import { formatNaira } from "@/domain/money";
import { salePriceKobo } from "@/domain/orders";
import {
  ArrowRightIcon,
  BackIcon,
  ChevronRightIcon,
  HandshakeIcon,
} from "./icons";
import { ProductImage, cx } from "./ui";

const ADVANCE_MS = 5000;

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * The explore page's banner: every boosted draw and item, one at a time,
 * moving on every few seconds. Pauses while hovered or focused, and doesn't
 * move on its own for people who've asked for less motion. Hidden when
 * nothing is boosted.
 */
export function SponsoredCarousel() {
  const q = useListings({ status: ["live", "for_sale"] });
  // All running boosts (the app-wide slot cap keeps this short), ending soonest first.
  const slides = q.data
    ? withSponsoredFirst(q.data, Date.now(), Infinity).sponsored
    : [];
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const region = useRef<HTMLElement>(null);
  const count = slides.length;
  const current = count ? index % count : 0;

  useEffect(() => {
    if (count < 2 || paused || prefersReducedMotion()) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % count), ADVANCE_MS);
    return () => clearInterval(t);
  }, [count, paused]);

  if (!count) return null;
  const go = (d: number) => setIndex((current + d + count) % count);

  return (
    <section
      ref={region}
      aria-roledescription="carousel"
      aria-label="Sponsored"
      className="relative"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) =>
        !region.current?.contains(e.relatedTarget as Node) && setPaused(false)
      }
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") go(-1);
        if (e.key === "ArrowRight") go(1);
      }}
    >
      <div className="overflow-hidden rounded-4xl shadow-lift">
        <div
          className="flex transition-transform duration-500 ease-out motion-reduce:transition-none"
          style={{ transform: `translateX(-${current * 100}%)` }}
        >
          {slides.map((l, i) => (
            <Slide
              key={l.id}
              listing={l}
              active={i === current}
              position={`${i + 1} of ${count}`}
            />
          ))}
        </div>
      </div>

      {count > 1 ? (
        <>
          <button
            onClick={() => go(-1)}
            aria-label="Previous sponsored item"
            className="absolute top-1/2 left-3 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-surface/90 text-ink shadow-card backdrop-blur transition hover:scale-105"
          >
            <BackIcon size={20} />
          </button>
          <button
            onClick={() => go(1)}
            aria-label="Next sponsored item"
            className="absolute top-1/2 right-3 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-surface/90 text-ink shadow-card backdrop-blur transition hover:scale-105"
          >
            <ChevronRightIcon size={20} />
          </button>
          <div
            className="mt-3 flex justify-center gap-1"
            role="group"
            aria-label="Choose a sponsored item"
          >
            {slides.map((l, i) => (
              <button
                key={l.id}
                onClick={() => setIndex(i)}
                aria-label={`Show ${l.title}`}
                aria-current={i === current ? "true" : undefined}
                className="flex size-11 items-center justify-center"
              >
                <span
                  className={cx(
                    "h-2 rounded-full transition-all",
                    i === current ? "w-6 bg-brand" : "w-2 bg-line-strong",
                  )}
                />
              </button>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

function Slide({
  listing: l,
  active,
  position,
}: {
  listing: ListingView;
  active: boolean;
  position: string;
}) {
  const price = salePriceKobo(l);
  return (
    <Link
      to={`/listings/${l.id}`}
      aria-roledescription="slide"
      aria-label={`Sponsored, ${position}: ${l.title}`}
      aria-hidden={!active}
      tabIndex={active ? 0 : -1}
      className="relative isolate flex min-h-64 w-full shrink-0 flex-col justify-end gap-3 overflow-hidden bg-hero p-6 pr-16 pl-16 text-on-hero no-underline sm:min-h-72 sm:p-8 sm:pr-20 sm:pl-20"
    >
      {l.images[0] ? (
        <img
          src={l.images[0]}
          alt=""
          loading="lazy"
          className="absolute inset-0 -z-20 size-full object-cover object-[50%_55%]"
        />
      ) : (
        <ProductImage
          category={l.category}
          size="lg"
          className="absolute inset-0 -z-20 size-full rounded-none"
        />
      )}
      <div className="absolute inset-0 -z-10 bg-linear-to-t from-hero via-hero/30 to-transparent sm:bg-linear-to-r sm:from-hero sm:via-hero/30 sm:to-transparent" />
      <span className="flex w-fit items-center gap-1.5 rounded-full bg-ticket px-2.5 py-1 text-[11px] font-extrabold text-on-ticket shadow-card">
        <HandshakeIcon size={12} /> Sponsored
      </span>
      <div className="flex max-w-lg flex-col gap-1 text-on-brand-muted">
        <span className="text-xs font-semibold">
          {l.merchant.name} · {l.category}
        </span>
        <strong className="font-display text-2xl leading-tight sm:text-3xl">
          {l.title}
        </strong>
        <span className="text-sm">
          {price !== null ? (
            <>
              Buy now for{" "}
              <strong className="text-ticket">{formatNaira(price)}</strong>
            </>
          ) : (
            <>
              Worth {formatNaira(l.priceKobo)} · tickets{" "}
              <strong className="text-ticket">
                {formatNaira(l.buyerTicketPriceKobo)}
              </strong>
            </>
          )}
        </span>
      </div>
      <span className="flex w-fit items-center gap-1 text-sm font-bold text-on-brand-muted">
        {price !== null ? "See the item" : "Get tickets"}{" "}
        <ArrowRightIcon size={16} />
      </span>
    </Link>
  );
}
