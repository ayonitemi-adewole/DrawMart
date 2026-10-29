import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  useBuyTickets,
  useListing,
  useRecordListingView,
  useAccess,
  useMe,
  useWallet,
} from "@/api/hooks";
import type { ListingView, PurchaseReceipt } from "@/api/types";
import { BuyNowPanel } from "@/components/BuyNowPanel";
import { RelatedListings } from "@/components/RelatedListings";
import { CopyButton } from "@/components/CopyButton";
import { Countdown } from "@/components/Countdown";
import {
  AlertIcon,
  BackIcon,
  CheckIcon,
  ChevronRightIcon,
  CoinIcon,
  GaugeIcon,
  LockIcon,
  MapPinIcon,
  MinusIcon,
  PlusIcon,
  ShareIcon,
  ShieldIcon,
  TicketIcon,
  TrophyIcon,
  TruckIcon,
} from "@/components/icons";
import { isAlmostGone, valueMultiple } from "@/components/ListingCard";
import { Sheet } from "@/components/Sheet";
import { TicketStub } from "@/components/TicketStub";
import { useToast } from "@/components/toast";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  IconButton,
  Notice,
  ProductImage,
  ProgressBar,
  Skeleton,
  buttonClass,
  cx,
  errorMessage,
} from "@/components/ui";
import { formatNaira } from "@/domain/money";
import { describeUnsoldPolicy, handoverMethodFor } from "@/domain/listing";
import {
  PURCHASE_ERROR_TEXT,
  RULES,
  checkPurchase,
  maxPurchasable,
  splitPayment,
  type PurchaseError,
} from "@/domain/rules";
import { ticketNo } from "@/lib/time";

export function ListingPage() {
  const { id = "" } = useParams();
  const listing = useListing(id);
  useRecordListingView(listing.data?.id);

  if (listing.isPending)
    return (
      <div className="grid gap-6 md:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-80" />
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-32" />
        </div>
        <Skeleton className="h-112" />
      </div>
    );
  if (listing.isError)
    return (
      <ErrorState error={listing.error} onRetry={() => listing.refetch()} />
    );
  // Keyed by id: opening a related listing starts fresh (photo, quantity, sheets).
  return listing.data.kind === "product" ? (
    <ProductDetail key={listing.data.id} listing={listing.data} />
  ) : (
    <ListingDetail key={listing.data.id} listing={listing.data} />
  );
}

/** A regular product: no tickets or draw, just the item and a fixed-price checkout. */
function ProductDetail({ listing: l }: { listing: ListingView }) {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col gap-5">
      <button
        onClick={() => navigate(-1)}
        className="-ml-2 flex min-h-11 w-fit items-center gap-1 rounded-xl px-2 text-sm font-bold text-muted hover:bg-sunken hover:text-ink"
      >
        <BackIcon size={18} /> Back
      </button>
      <div className="grid gap-6 md:grid-cols-[1fr_380px] md:items-start">
        <div className="flex min-w-0 flex-col gap-5">
          <div className="relative animate-fade-up">
            <Gallery listing={l} />
            <div className="pointer-events-none absolute top-4 left-4 flex flex-wrap gap-1.5">
              <Badge tone="neutral" className="bg-surface/85 backdrop-blur">
                {l.category}
              </Badge>
              {l.status === "sold" ? <Badge tone="hot">SOLD</Badge> : null}
            </div>
          </div>
          <div className="flex animate-fade-up flex-col gap-3 [animation-delay:60ms]">
            <div className="flex flex-wrap gap-1.5">
              {l.merchant.verified ? (
                <Badge>
                  <CheckIcon size={12} />{" "}
                  {l.merchant.kind === "individual"
                    ? "ID-verified seller"
                    : "Verified store"}
                </Badge>
              ) : null}
              <Badge tone="sky">
                <TruckIcon size={12} /> Delivered in Lagos
              </Badge>
            </div>
            <h1 className="font-display text-3xl leading-tight font-extrabold tracking-tight md:text-4xl">
              {l.title}
            </h1>
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft font-display font-extrabold text-brand-ink">
                {l.merchant.name.charAt(0)}
              </span>
              <div className="flex flex-col text-sm leading-tight">
                <strong>{l.merchant.name}</strong>
                <span className="flex items-center gap-1 text-xs text-subtle">
                  <MapPinIcon size={12} /> {l.merchant.area}, Lagos
                </span>
              </div>
            </div>
          </div>
          <Card className="flex flex-col gap-3 p-5 text-sm leading-relaxed text-muted">
            <strong className="text-ink">About the item</strong>
            <p>{l.description || "No description from the store yet."}</p>
            <p className="text-xs text-subtle">
              {l.merchant.kind === "individual"
                ? `Listed by ${l.merchant.name}, an individual seller whose ID DrawMart has checked. Reviewed by DrawMart before going on sale.`
                : `Listed by ${l.merchant.name} (${l.merchant.cacNumber}) and reviewed by DrawMart before going on sale.`}
            </p>
          </Card>
          <Card className="p-5 text-sm text-muted">
            <ul className="flex flex-col gap-3">
              <li className="flex gap-3">
                <TruckIcon size={20} className="shrink-0 text-brand" /> The
                store sends it to the address you give at checkout.
              </li>
              <li className="flex gap-3">
                <ShieldIcon size={20} className="shrink-0 text-brand" /> You
                pay from your wallet; the store is only paid after you confirm
                delivery.
              </li>
              <li className="flex gap-3">
                <CoinIcon size={20} className="shrink-0 text-brand" /> Store
                credit from past draws is spent first.
              </li>
            </ul>
          </Card>
        </div>
        <div className="md:sticky md:top-24">
          <BuyNowPanel listing={l} />
        </div>
      </div>
      <RelatedListings listing={l} />
    </div>
  );
}

function ListingDetail({ listing: l }: { listing: ListingView }) {
  const navigate = useNavigate();
  const toast = useToast();
  const buyRef = useRef<HTMLDivElement>(null);
  const panelVisible = useInView(buyRef);
  const left = l.ticketCount - l.ticketsSold;
  const pct = Math.round((l.ticketsSold / l.ticketCount) * 100);
  const hot = isAlmostGone(l);

  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share)
        await navigator.share({
          title: l.title,
          text: `Win ${l.title} for ${formatNaira(l.buyerTicketPriceKobo)} on DrawMart`,
          url,
        });
      else {
        await navigator.clipboard.writeText(url);
        toast("Link copied. Share it with a friend.", "info");
      }
    } catch {
      /* share sheet dismissed */
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          className="-ml-2 flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm font-bold text-muted hover:bg-sunken hover:text-ink"
        >
          <BackIcon size={18} /> Back
        </button>
        <IconButton aria-label="Share this draw" onClick={share}>
          <ShareIcon />
        </IconButton>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_380px] md:items-start">
        <div className="flex min-w-0 flex-col gap-5">
          <div className="relative animate-fade-up">
            <Gallery listing={l} />
            <div className="pointer-events-none absolute top-4 left-4 flex flex-wrap gap-1.5">
              <Badge tone="neutral" className="bg-surface/85 backdrop-blur">
                {l.category}
              </Badge>
              {hot ? (
                <Badge tone="hot" className="shadow-card">
                  ALMOST GONE
                </Badge>
              ) : null}
            </div>
            <span className="pointer-events-none absolute top-4 right-4 rounded-2xl bg-ink px-3 py-2 text-sm font-extrabold text-ground shadow-lift">
              {valueMultiple(l)}× cheaper than buying it
            </span>
          </div>

          <div className="flex animate-fade-up flex-col gap-3 [animation-delay:60ms]">
            <div className="flex flex-wrap gap-1.5">
              {l.merchant.verified ? (
                <Badge>
                  <CheckIcon size={12} /> Verified store
                </Badge>
              ) : null}
              <Badge tone="sky">
                <LockIcon size={12} />{" "}
                {handoverMethodFor(l.category) === "inspection"
                  ? "Inspected by DrawMart"
                  : "Item held in escrow"}
              </Badge>
              <Badge tone="violet">
                <ShieldIcon size={12} /> Provably fair
              </Badge>
            </div>
            <h1 className="font-display text-3xl leading-tight font-extrabold tracking-tight md:text-4xl">
              {l.title}
            </h1>
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft font-display font-extrabold text-brand-ink">
                {l.merchant.name.charAt(0)}
              </span>
              <div className="flex flex-col text-sm leading-tight">
                <strong>{l.merchant.name}</strong>
                <span className="flex items-center gap-1 text-xs text-subtle">
                  <MapPinIcon size={12} /> {l.merchant.area}, Lagos
                </span>
              </div>
            </div>
          </div>

          <dl className="grid animate-fade-up grid-cols-2 gap-2 [animation-delay:120ms] sm:grid-cols-4">
            {[
              { k: "Worth", v: formatNaira(l.priceKobo) },
              { k: "Per ticket", v: formatNaira(l.buyerTicketPriceKobo) },
              {
                k: "Odds per ticket",
                v: `1 in ${l.ticketCount.toLocaleString("en-NG")}`,
              },
              {
                k: l.status === "live" ? "Closes in" : "Status",
                v:
                  l.status === "live" ? (
                    <Countdown closesAt={l.closesAt} icon={false} />
                  ) : (
                    STATUS_TEXT[l.status]
                  ),
              },
            ].map(({ k, v }) => (
              <div
                key={k}
                className="flex flex-col gap-0.5 rounded-2xl border border-line bg-surface p-3"
              >
                <dt className="text-[11px] font-semibold text-subtle">{k}</dt>
                <dd className="font-extrabold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>

          <Card className="flex flex-col gap-3 p-5">
            <div className="flex items-end justify-between gap-3">
              <div className="flex flex-col">
                <span className="font-display text-3xl font-extrabold tabular-nums">
                  {pct}%
                </span>
                <span className="text-sm text-muted">
                  {l.ticketsSold.toLocaleString("en-NG")} of{" "}
                  {l.ticketCount.toLocaleString("en-NG")} tickets sold
                </span>
              </div>
              {l.status === "live" ? (
                <span
                  className={cx(
                    "rounded-full px-3 py-1 text-xs font-extrabold",
                    hot
                      ? "bg-hot-soft text-hot-ink"
                      : "bg-brand-soft text-brand-ink",
                  )}
                >
                  {left.toLocaleString("en-NG")} left
                </span>
              ) : null}
            </div>
            <ProgressBar
              value={l.ticketsSold}
              max={l.ticketCount}
              hot={hot}
              label="Tickets sold"
              size="lg"
            />
            <p className="text-xs leading-relaxed text-subtle">
              The draw runs the moment the last ticket sells.{" "}
              {describeUnsoldPolicy(l.unsoldPolicy, l.fallbackPriceKobo)}
            </p>
          </Card>

          {l.myNumbers.length > 0 ? (
            <Card className="flex flex-col gap-3 p-5">
              <div className="flex items-center justify-between">
                <strong className="flex items-center gap-2">
                  <TicketIcon size={18} className="text-brand" /> Your tickets
                </strong>
                <span className="text-xs font-bold text-subtle">
                  {l.myNumbers.length} of {RULES.maxTicketsPerUserPerListing}{" "}
                  max
                </span>
              </div>
              <div className="flex flex-wrap gap-2.5 px-1.5">
                {l.myNumbers.map((n) => (
                  <TicketStub
                    key={n}
                    number={n}
                    size="sm"
                    state={
                      l.result
                        ? n === l.result.winningNumber
                          ? "winner"
                          : "lost"
                        : "default"
                    }
                  />
                ))}
              </div>
            </Card>
          ) : null}

          <InfoTabs listing={l} />
        </div>

        <div ref={buyRef} id="buy" className="scroll-mt-24 md:sticky md:top-24">
          <BuyPanel listing={l} left={left} />
        </div>
      </div>

      <RelatedListings listing={l} />

      {l.status === "live" && !panelVisible ? (
        <div className="fixed inset-x-3 bottom-[calc(max(env(safe-area-inset-bottom),12px)+80px)] z-20 animate-sheet-up md:hidden">
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-raised/95 p-2 pl-4 shadow-lift backdrop-blur-xl">
            <div className="flex flex-col leading-tight">
              <span className="text-[11px] text-subtle">
                {left.toLocaleString("en-NG")} left
              </span>
              <strong>{formatNaira(l.buyerTicketPriceKobo)} / ticket</strong>
            </div>
            <button
              onClick={() =>
                buyRef.current?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                })
              }
              className={buttonClass("primary")}
            >
              Get tickets
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Main photo with thumbnails, arrow buttons, keyboard and swipe support. */
function Gallery({ listing: l }: { listing: ListingView }) {
  const [index, setIndex] = useState(0);
  const touchX = useRef<number | null>(null);
  const count = l.images.length;
  const go = (d: number) => setIndex((i) => (i + d + count) % count);

  if (count === 0)
    return (
      <ProductImage
        category={l.category}
        size="lg"
        className="h-72 rounded-4xl border border-line md:h-112"
      />
    );

  return (
    <div className="flex flex-col gap-3">
      <div
        className="group relative"
        role="region"
        aria-roledescription="carousel"
        aria-label={`${l.title} photos`}
        tabIndex={count > 1 ? 0 : undefined}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") go(-1);
          if (e.key === "ArrowRight") go(1);
        }}
        onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touchX.current === null) return;
          const dx = e.changedTouches[0].clientX - touchX.current;
          if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
          touchX.current = null;
        }}
      >
        <ProductImage
          key={l.images[index]}
          category={l.category}
          src={l.images[index]}
          alt={`${l.title}, photo ${index + 1} of ${count}`}
          size="lg"
          eager
          className="h-72 animate-fade-in rounded-4xl border border-line md:h-112"
        />
        {count > 1 ? (
          <>
            <button
              onClick={() => go(-1)}
              aria-label="Previous photo"
              className="absolute top-1/2 left-3 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-surface/90 text-ink shadow-card backdrop-blur transition hover:scale-105 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
            >
              <BackIcon size={20} />
            </button>
            <button
              onClick={() => go(1)}
              aria-label="Next photo"
              className="absolute top-1/2 right-3 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-surface/90 text-ink shadow-card backdrop-blur transition hover:scale-105 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
            >
              <ChevronRightIcon size={20} />
            </button>
            <span
              className="absolute bottom-4 left-4 rounded-full bg-ink/75 px-2.5 py-1 text-xs font-bold text-ground tabular-nums backdrop-blur"
              aria-live="polite"
            >
              {index + 1} / {count}
            </span>
          </>
        ) : null}
        {l.kind === "raffle" ? (
          <span className="absolute right-4 bottom-4 flex items-center gap-1 rounded-full bg-surface/90 px-2.5 py-1 text-[11px] font-bold text-brand-ink shadow-card backdrop-blur">
            <CheckIcon size={12} />{" "}
            {handoverMethodFor(l.category) === "inspection"
              ? "Photographed at inspection"
              : "Photographed at escrow"}
          </span>
        ) : null}
      </div>
      {count > 1 ? (
        <div
          className="no-scrollbar flex gap-2 overflow-x-auto"
          role="group"
          aria-label="Choose photo"
        >
          {l.images.map((src, i) => (
            <button
              key={src}
              onClick={() => setIndex(i)}
              aria-label={`Show photo ${i + 1}`}
              aria-pressed={i === index}
              className={cx(
                "shrink-0 rounded-2xl border-2 p-0.5 transition",
                i === index
                  ? "border-brand"
                  : "border-transparent opacity-70 hover:opacity-100",
              )}
            >
              <ProductImage
                category={l.category}
                src={src}
                size="sm"
                className="size-18 rounded-xl"
              />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const STATUS_TEXT: Record<ListingView["status"], string> = {
  pending_review: "In review",
  live: "Live",
  drawn: "Drawn",
  refunded: "Refunded",
  for_sale: "Buy now",
  sold: "Sold",
  rejected: "Not on sale",
};

function useInView(ref: React.RefObject<HTMLElement | null>) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), {
      threshold: 0.15,
    });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return visible;
}

type Tab = "about" | "fair" | "delivery";

function InfoTabs({ listing: l }: { listing: ListingView }) {
  const [tab, setTab] = useState<Tab>("about");
  const tabs: { id: Tab; label: string }[] = [
    { id: "about", label: "About the item" },
    { id: "fair", label: "Fair draw" },
    { id: "delivery", label: "Delivery" },
  ];
  return (
    <Card className="overflow-hidden">
      <div
        role="tablist"
        aria-label="Listing details"
        className="no-scrollbar flex overflow-x-auto border-b border-line px-2"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => setTab(t.id)}
            className={cx(
              "relative min-h-12 shrink-0 px-3 text-sm font-bold transition",
              tab === t.id ? "text-ink" : "text-subtle hover:text-ink",
            )}
          >
            {t.label}
            <span
              className={cx(
                "absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-brand transition-transform",
                tab === t.id ? "scale-x-100" : "scale-x-0",
              )}
            />
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        key={tab}
        className="animate-fade-in p-5 text-sm leading-relaxed text-muted"
      >
        {tab === "about" ? (
          <div className="flex flex-col gap-3">
            <p>{l.description || "No description from the store yet."}</p>
            <p className="text-xs text-subtle">
              Listed by {l.merchant.name} ({l.merchant.cacNumber}).{" "}
              {handoverMethodFor(l.category) === "inspection"
                ? "A DrawMart inspector has checked the vehicle and its papers and confirmed they match this listing."
                : "DrawMart has checked the item into escrow and confirmed it matches this listing."}
            </p>
          </div>
        ) : tab === "fair" ? (
          <div className="flex flex-col gap-3">
            <p>
              Before sales opened we published a{" "}
              <strong className="text-ink">lock</strong> on a secret number.
              After sell-out we reveal it, and the winning ticket is calculated
              from it and the final purchase. Anyone can re-check the maths.
            </p>
            <div className="flex items-center gap-1 rounded-2xl bg-ground py-1 pr-1 pl-3">
              <LockIcon size={16} className="shrink-0 text-brand" />
              <code className="min-w-0 flex-1 truncate font-mono text-xs text-ink">
                {l.commitment}
              </code>
              <CopyButton value={l.commitment} label="lock" />
            </div>
            <Link to="/draws" className="text-sm">
              How verification works →
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            <li className="flex gap-3">
              <TruckIcon size={20} className="shrink-0 text-brand" />{" "}
              {handoverMethodFor(l.category) === "inspection"
                ? "The vehicle was inspected before listing and stays with the dealer until handover. The winner collects it with the papers in their name."
                : "The item is already in a DrawMart escrow point. The winner gets it delivered anywhere in Lagos."}
            </li>
            <li className="flex gap-3">
              <ShieldIcon size={20} className="shrink-0 text-brand" /> The store
              is only paid after the winner confirms delivery.
            </li>
            <li className="flex gap-3">
              <CoinIcon size={20} className="shrink-0 text-brand" /> Everyone
              else gets {RULES.consolationCreditBps / 100}% of their spend back
              as store credit.
            </li>
          </ul>
        )}
      </div>
    </Card>
  );
}

function BuyPanel({
  listing: l,
  left,
}: {
  listing: ListingView;
  left: number;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const me = useMe();
  const wallet = useWallet();
  const access = useAccess();
  const signedOut = access.ready && !access.signedIn;
  const buy = useBuyTickets();
  const held = l.myNumbers.length;
  const max = maxPurchasable(l, held);
  const [qty, setQty] = useState(1);
  const q = Math.max(1, Math.min(qty, Math.max(1, max)));
  const [confirming, setConfirming] = useState(false);
  const [receipt, setReceipt] = useState<PurchaseReceipt | null>(null);

  if (l.status === "drawn" && l.result) {
    const r = l.result;
    return (
      <Card className="flex flex-col items-center gap-4 overflow-hidden p-6 text-center">
        <span
          className={cx(
            "flex size-16 items-center justify-center rounded-3xl",
            r.iWon
              ? "bg-ticket text-on-ticket"
              : "bg-brand-soft text-brand-ink",
          )}
        >
          <TrophyIcon size={32} />
        </span>
        <div className="flex flex-col gap-1">
          <strong className="font-display text-2xl">
            {r.iWon ? "You won this!" : "Draw complete"}
          </strong>
          <p className="text-sm text-muted">
            Winning ticket {ticketNo(r.winningNumber)}
          </p>
        </div>
        <Link
          to={`/draws/${l.id}`}
          className={buttonClass("ticket", "lg", "w-full")}
        >
          See result and verify
        </Link>
      </Card>
    );
  }
  if (l.status === "for_sale" || l.status === "sold")
    return <BuyNowPanel listing={l} />;
  if (l.status !== "live") {
    return (
      <Card className="p-5">
        <Notice
          tone="neutral"
          title={l.status === "refunded" ? "Refunded" : "Not on sale"}
        >
          {l.status === "refunded"
            ? "This draw didn’t sell out in time. Everyone who bought a ticket was refunded."
            : "This listing isn’t on sale."}
        </Notice>
      </Card>
    );
  }

  const cost = q * l.buyerTicketPriceKobo;
  const balance = wallet.data?.balance;
  const pay = balance ? splitPayment(cost, balance) : null;
  const blocker: PurchaseError | null =
    me.data && wallet.data
      ? checkPurchase({
          user: me.data,
          listing: l,
          quantity: q,
          ticketsAlreadyHeld: held,
          balance: wallet.data.balance,
          spentThisWeekKobo: wallet.data.spentThisWeekKobo,
        })
      : null;
  const oddsPct = ((held + q) / l.ticketCount) * 100;
  const presets = [...new Set([1, 5, 10, max])].filter(
    (n) => n >= 1 && n <= max,
  );

  async function onConfirm() {
    try {
      const r = await buy.mutateAsync({ listingId: l.id, quantity: q });
      setConfirming(false);
      setQty(1);
      if (r.drawn) navigate(`/draws/${l.id}`);
      else setReceipt(r);
    } catch (e) {
      setConfirming(false);
      toast(errorMessage(e), "error");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-col gap-5 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col">
            <span className="font-display text-xl font-extrabold">
              Get your tickets
            </span>
            <span className="text-xs text-subtle">
              {formatNaira(l.buyerTicketPriceKobo)} each · max{" "}
              {RULES.maxTicketsPerUserPerListing} per person
            </span>
          </div>
          <Countdown
            closesAt={l.closesAt}
            className="rounded-full bg-sunken px-2.5 py-1 text-xs font-bold"
          />
        </div>

        {max > 0 ? (
          <>
            <div className="flex items-center justify-between gap-2 rounded-2xl bg-ground p-2">
              <button
                onClick={() => setQty(q - 1)}
                disabled={q <= 1}
                aria-label="Fewer tickets"
                className="flex size-12 items-center justify-center rounded-xl bg-surface shadow-card transition active:scale-90 disabled:opacity-40"
              >
                <MinusIcon />
              </button>
              <div className="flex flex-col items-center">
                <output
                  key={q}
                  className="animate-pop font-display text-4xl leading-none font-extrabold tabular-nums"
                  aria-live="polite"
                >
                  {q}
                </output>
                <span className="text-[11px] font-semibold text-subtle">
                  {q === 1 ? "ticket" : "tickets"}
                </span>
              </div>
              <button
                onClick={() => setQty(q + 1)}
                disabled={q >= max}
                aria-label="More tickets"
                className="flex size-12 items-center justify-center rounded-xl bg-surface shadow-card transition active:scale-90 disabled:opacity-40"
              >
                <PlusIcon />
              </button>
            </div>

            {max > 1 ? (
              <>
                <label htmlFor="qty-range" className="sr-only">
                  Number of tickets
                </label>
                <input
                  id="qty-range"
                  type="range"
                  className="range w-full"
                  min={1}
                  max={max}
                  value={q}
                  onChange={(e) => setQty(Number(e.target.value))}
                  style={
                    {
                      "--fill": `${((q - 1) / Math.max(1, max - 1)) * 100}%`,
                    } as React.CSSProperties
                  }
                />
                <div className="flex gap-2">
                  {presets.map((n) => (
                    <button
                      key={n}
                      onClick={() => setQty(n)}
                      aria-pressed={q === n}
                      className={cx(
                        "min-h-11 flex-1 rounded-xl border text-sm font-bold transition active:scale-95",
                        q === n
                          ? "border-ink bg-ink text-ground"
                          : "border-line-strong bg-surface hover:border-ink/40",
                      )}
                    >
                      {n === max && n !== 1 && n !== 5 && n !== 10
                        ? `Max ${n}`
                        : n}
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            <div className="flex items-center gap-3 rounded-2xl bg-violet-soft p-3 text-violet">
              <GaugeIcon size={22} className="shrink-0" />
              <div className="flex flex-col text-sm leading-tight">
                <span>
                  Your odds:{" "}
                  <strong>
                    {(held + q).toLocaleString("en-NG")} in{" "}
                    {l.ticketCount.toLocaleString("en-NG")}
                  </strong>
                </span>
                <span className="text-xs opacity-80">
                  {oddsPct < 0.01
                    ? "<0.01"
                    : oddsPct.toFixed(oddsPct < 1 ? 2 : 1)}
                  % chance to win
                </span>
              </div>
            </div>

            <dl className="flex flex-col gap-1.5 border-t border-dashed border-line pt-4 text-sm">
              {pay && pay.fromCredit > 0 ? (
                <>
                  <div className="flex justify-between">
                    <dt className="text-subtle">From store credit</dt>
                    <dd className="font-semibold text-ticket-ink">
                      −{formatNaira(pay.fromCredit)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-subtle">From cash</dt>
                    <dd className="font-semibold">
                      −{formatNaira(pay.fromCash)}
                    </dd>
                  </div>
                </>
              ) : null}
              <div className="flex items-baseline justify-between">
                <dt className="font-bold">Total</dt>
                <dd
                  key={cost}
                  className="animate-fade-in font-display text-2xl font-extrabold tabular-nums"
                >
                  {formatNaira(cost)}
                </dd>
              </div>
              {balance ? (
                <div className="flex justify-between text-xs text-subtle">
                  <dt>Wallet after</dt>
                  <dd className="tabular-nums">
                    {formatNaira(
                      Math.max(0, balance.cashKobo + balance.creditKobo - cost),
                    )}
                  </dd>
                </div>
              ) : null}
            </dl>

            {blocker ? <BlockerNotice error={blocker} /> : null}

            {signedOut ? (
              <Link
                to={`/login?next=${encodeURIComponent(`/listings/${l.id}`)}`}
                className={buttonClass("primary", "lg")}
              >
                <TicketIcon size={20} className="text-on-brand" />
                <span className="text-on-brand">Sign in to get tickets</span>
              </Link>
            ) : (
              <Button
                size="lg"
                onClick={() => setConfirming(true)}
                disabled={!!blocker || !wallet.data || !me.data}
              >
                <TicketIcon size={20} />
                Get {q} {q === 1 ? "ticket" : "tickets"}
              </Button>
            )}
          </>
        ) : (
          <Notice
            tone="ticket"
            icon={TicketIcon}
            title={left <= 0 ? "Sold out" : "You’ve hit the ticket limit"}
          >
            {left <= 0
              ? PURCHASE_ERROR_TEXT.sold_out
              : PURCHASE_ERROR_TEXT.per_user_limit}
          </Notice>
        )}
      </Card>

      <Notice
        tone="ticket"
        icon={CoinIcon}
        title="Didn’t win? You still get something."
      >
        {RULES.consolationCreditBps / 100}% of what you spent comes back as
        store credit for any draw or buy-now.
      </Notice>

      <Button
        variant="outline"
        onClick={() =>
          toast(
            "Buy-now checkout is coming next: pay the full price and the store delivers.",
            "info",
          )
        }
      >
        Skip the draw: buy now for {formatNaira(l.priceKobo)}
      </Button>

      <Sheet
        open={confirming}
        onClose={() => !buy.isPending && setConfirming(false)}
        title="Confirm your tickets"
      >
        <div className="flex flex-col gap-1 pr-10">
          <span className="text-xs font-extrabold tracking-[0.14em] text-brand uppercase">
            Confirm
          </span>
          <h2 className="font-display text-2xl leading-tight font-extrabold">
            {q} {q === 1 ? "ticket" : "tickets"} for {l.title}
          </h2>
        </div>
        <div className="flex items-center gap-3 rounded-2xl bg-ground p-3">
          <ProductImage
            category={l.category}
            src={l.images[0]}
            alt={l.title}
            size="sm"
            className="size-16 shrink-0"
          />
          <div className="flex flex-col text-sm">
            <strong>{formatNaira(cost)}</strong>
            <span className="text-xs text-subtle">
              {q} × {formatNaira(l.buyerTicketPriceKobo)}
              {pay && pay.fromCredit > 0
                ? ` · ${formatNaira(pay.fromCredit)} from store credit`
                : ""}
            </span>
          </div>
        </div>
        <ul className="flex flex-col gap-2 text-sm text-muted">
          <li className="flex gap-2">
            <CheckIcon size={18} className="shrink-0 text-brand" /> Tickets are
            numbered in the order they’re bought.
          </li>
          <li className="flex gap-2">
            <CheckIcon size={18} className="shrink-0 text-brand" /> No refunds
            once bought, unless the draw doesn’t sell out.
          </li>
          <li className="flex gap-2">
            <CheckIcon size={18} className="shrink-0 text-brand" /> If you don’t
            win, {RULES.consolationCreditBps / 100}% comes back as credit.
          </li>
        </ul>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => setConfirming(false)}
            disabled={buy.isPending}
          >
            Cancel
          </Button>
          <Button
            className="flex-2"
            size="lg"
            loading={buy.isPending}
            onClick={onConfirm}
          >
            Pay {formatNaira(cost)}
          </Button>
        </div>
      </Sheet>

      <Sheet
        open={!!receipt}
        onClose={() => setReceipt(null)}
        title="Tickets confirmed"
      >
        {receipt ? (
          <div className="flex flex-col items-center gap-4 pt-2 text-center">
            <span className="flex size-16 animate-pop items-center justify-center rounded-3xl bg-brand text-on-brand shadow-glow">
              <CheckIcon size={34} strokeWidth={3} />
            </span>
            <div className="flex flex-col gap-1">
              <h2 className="font-display text-2xl font-extrabold">
                You’re in the draw!
              </h2>
              <p className="text-sm text-muted">
                {formatNaira(receipt.costKobo)} paid · ref{" "}
                <span className="font-mono">{receipt.purchaseId}</span>
              </p>
            </div>
            <div className="flex max-h-48 flex-wrap justify-center gap-2.5 overflow-y-auto px-2 py-1">
              {receipt.numbers.map((n, i) => (
                <TicketStub
                  key={n}
                  number={n}
                  state="new"
                  notch="bg-raised"
                  style={{ animationDelay: `${i * 70}ms` }}
                />
              ))}
            </div>
            <p className="text-xs text-subtle">
              We’ll notify you the moment the last ticket sells and the draw
              runs.
            </p>
            <div className="flex w-full gap-2">
              <Link
                to="/tickets"
                className={buttonClass("outline", "md", "flex-1")}
              >
                My tickets
              </Link>
              <Button className="flex-1" onClick={() => setReceipt(null)}>
                Done
              </Button>
            </div>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}

/** Explains why a purchase would be refused, with the next step to fix it. */
function BlockerNotice({ error }: { error: PurchaseError }) {
  const action =
    error === "insufficient_funds" ? (
      <Link to="/wallet" className="font-bold">
        Top up your wallet →
      </Link>
    ) : error === "weekly_limit" ? (
      <Link to="/wallet" className="font-bold">
        Review your weekly limit →
      </Link>
    ) : error === "state_not_licensed" ? (
      <Link to="/wallet" className="font-bold">
        Check your state of residence →
      </Link>
    ) : null;
  return (
    <Notice tone="hot" icon={AlertIcon} action={action}>
      {PURCHASE_ERROR_TEXT[error]}
    </Notice>
  );
}
