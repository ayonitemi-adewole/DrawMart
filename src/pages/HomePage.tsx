import { useLayoutEffect, useMemo, useRef } from "react";
import { Link, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { useSearchParam } from "@/lib/useSearchParam";
import { listingMatchesSearch } from "@/domain/productCode";
import { useListings, useWinnersWall } from "@/api/hooks";
import type { ListingView } from "@/api/types";
import { AllCategoriesIcon, CATEGORY_STYLE } from "@/components/category";
import { Countdown } from "@/components/Countdown";
import { HowItWorksGrid } from "@/components/HowItWorks";
import { PracticePrompt } from "@/components/PracticePrompt";
import {
  ArrowRightIcon,
  NairaIcon,
  FlameIcon,
  LockIcon,
  SearchIcon,
  ShieldIcon,
  SparklesIcon,
  XIcon,
} from "@/components/icons";
import { isAlmostGone, valueMultiple } from "@/components/ListingCard";
import { ListingRow, SeeAllLink } from "@/components/ListingGrid";
import { SponsoredCarousel } from "@/components/SponsoredCarousel";
import { WinnerCard } from "@/components/WinnerStory";
import { browseHref } from "@/pages/BrowsePage";
import {
  EmptyState,
  ErrorState,
  LiveDot,
  ProductImage,
  ProgressBar,
  Skeleton,
  buttonClass,
  chipClass,
  cx,
  inputCls,
} from "@/components/ui";
import type { BrowseOptions } from "@/domain/browse";
import { formatNaira, nairaToKobo } from "@/domain/money";
import { RULES } from "@/domain/rules";
import { withSponsoredFirst } from "@/domain/boosts";
import { CATEGORIES, type Category } from "@/domain/types";

type Sort = "popular" | "ending" | "cheapest" | "value";
const SORTS = [
  { value: "popular", label: "home.sortPopular" },
  { value: "ending", label: "home.sortEnding" },
  { value: "cheapest", label: "home.sortCheapest" },
  { value: "value", label: "home.sortValue" },
] as const;

const BROWSE_SHORTCUTS: { key: string; label: "home.upTo" | "home.closingToday" | "home.almostSoldOut" | "home.newThisWeek"; options: Partial<BrowseOptions> }[] = [
  { key: "ticket", label: "home.upTo", options: { maxTicket: 1000 } },
  { key: "closing", label: "home.closingToday", options: { closingToday: true } },
  { key: "almost", label: "home.almostSoldOut", options: { almostSoldOut: true } },
  { key: "new", label: "home.newThisWeek", options: { newThisWeek: true } },
];

function sortListings(list: ListingView[], sort: Sort) {
  const out = [...list];
  if (sort === "ending")
    out.sort((a, b) => a.closesAt.localeCompare(b.closesAt));
  if (sort === "cheapest")
    out.sort((a, b) => a.buyerTicketPriceKobo - b.buyerTicketPriceKobo);
  if (sort === "value") out.sort((a, b) => b.priceKobo - a.priceKobo);
  return out; // 'popular' keeps the API order: closest to selling out first
}

export function HomePage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const raw = params.get("category");
  const category = CATEGORIES.includes(raw as Category)
    ? (raw as Category)
    : undefined;
  const categoryName = category ? t(`categories.${category}`) : "";
  const query = params.get("q") ?? "";
  const search = useSearchParam();
  const sort = (
    SORTS.some((s) => s.value === params.get("sort"))
      ? params.get("sort")
      : "popular"
  ) as Sort;

  const listings = useListings({ category });
  const all = useListings();
  const forSale = useListings({ category, status: ["for_sale"] });

  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    // Filters, sort and search stay where you are on the page.
    setParams(next, { replace: true, preventScrollReset: true });
  };

  const visible = useMemo(() => {
    if (!listings.data) return [];
    const filtered = listings.data.filter((l) =>
      listingMatchesSearch(l, query),
    );
    // Paid boosts sit on top whatever the sort, a few at a time.
    const { sponsored, rest } = withSponsoredFirst(
      sortListings(filtered, sort),
      Date.now(),
    );
    return [...sponsored, ...rest];
  }, [listings.data, query, sort]);
  const shop = useMemo(() => {
    const { sponsored, rest } = withSponsoredFirst(
      (forSale.data ?? []).filter((l) => listingMatchesSearch(l, query)),
      Date.now(),
    );
    return [...sponsored, ...rest];
  }, [forSale.data, query]);

  // A new filter or search changes the page's length, so from further down it
  // would land somewhere random. Start at the results, and also go to them when
  // searching from the top bar, which can be well above them.
  const resultsTop = useRef<HTMLDivElement>(null);
  const shownFilter = useRef(`${category}|${query}`);
  useLayoutEffect(() => {
    const filter = `${category}|${query}`;
    if (filter === shownFilter.current) return;
    shownFilter.current = filter;
    const el = resultsTop.current;
    if (!el) return;
    const past = el.getBoundingClientRect().top < parseFloat(getComputedStyle(el).scrollMarginTop);
    const fromTopBar = Boolean(document.activeElement?.closest("header"));
    if (past || fromTopBar) el.scrollIntoView();
  }, [category, query]);

  return (
    <div className="flex flex-col gap-8">
      <Hero
        listings={all.data}
        query={search.text}
        onQuery={search.change}
      />

      {!category && !query ? <PracticePrompt /> : null}

      {!category && !query ? <SponsoredCarousel /> : null}

      {!category && !query ? <BigPrizes listings={all.data} /> : null}

      <div ref={resultsTop} aria-hidden className="-mb-8 scroll-mt-16" />
      {/* Outside the sections, so it stays stuck all the way down the page. */}
      <div
        className="no-scrollbar sticky top-16 z-20 -mx-4 -mb-6 flex gap-2 overflow-x-auto bg-ground px-4 py-2 sm:-mx-6 sm:px-6"
        role="group"
        aria-label={t("home.filterByCategory")}
      >
        {[undefined, ...CATEGORIES].map((c) => {
          const active = c === category;
          const Icon = c ? CATEGORY_STYLE[c].icon : AllCategoriesIcon;
          const count = c
            ? all.data?.filter((l) => l.category === c).length
            : all.data?.length;
          return (
            <button
              key={c ?? "all"}
              onClick={() => update({ category: c })}
              aria-pressed={active}
              className={chipClass(active)}
            >
              <Icon size={17} />
              {c ? t(`categories.${c}`) : t("home.allDraws")}
              {count ? (
                <span
                  className={cx(
                    "text-xs",
                    active ? "text-ground/70" : "text-subtle",
                  )}
                >
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <section className="flex flex-col gap-4" aria-labelledby="live-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2
            id="live-heading"
            className="flex items-center gap-2 font-display text-2xl font-extrabold tracking-tight"
          >
            <LiveDot className="text-hot" />
            {categoryName ? t("home.categoryDraws", { category: categoryName }) : t("home.liveDraws")}
            {listings.data ? (
              <span className="text-base font-semibold text-subtle">
                ({visible.length})
              </span>
            ) : null}
          </h2>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-subtle">{t("home.sort")}</span>
            <select
              value={sort}
              onChange={(e) =>
                update({
                  sort:
                    e.target.value === "popular" ? undefined : e.target.value,
                })
              }
              className={cx(
                inputCls,
                "min-h-11 w-auto bg-surface pr-8 font-bold",
              )}
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {t(s.label)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div
          className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-1 sm:-mx-6 sm:px-6"
          role="group"
          aria-label={t("home.shortcuts")}
        >
          {BROWSE_SHORTCUTS.map((s) => (
            <Link
              key={s.key}
              to={browseHref({
                category,
                q: query || undefined,
                type: "draws",
                options: s.options,
              })}
              className={chipClass(false)}
            >
              {t(s.label, { price: formatNaira(nairaToKobo(1000)) })}
            </Link>
          ))}
        </div>

        {query ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            {t("home.resultsFor")} <strong className="text-ink">“{query}”</strong>
            <button
              onClick={() => update({ q: undefined })}
              className="flex min-h-11 items-center gap-1 rounded-xl px-2 font-bold text-brand hover:bg-brand-soft"
            >
              <XIcon size={14} /> {t("home.clear")}
            </button>
          </div>
        ) : null}

        {listings.isPending ? (
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-80" />
            ))}
          </div>
        ) : listings.isError ? (
          <ErrorState
            error={listings.error}
            onRetry={() => listings.refetch()}
          />
        ) : visible.length === 0 && query && shop.length ? (
          <p className="text-sm text-muted">
            {t("home.nothingLiveMatchesButShop")}
          </p>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={SearchIcon}
            title={query ? t("home.noMatches") : t("home.nothingLive")}
            body={query ? t("home.noMatchesBody", { query }) : t("home.nothingLiveBody", { category: categoryName || t("home.thisCategory") })}
            action={
              <button
                onClick={() => update({ q: undefined, category: undefined })}
                className={buttonClass("outline")}
              >
                {t("home.seeAllDraws")}
              </button>
            }
          />
        ) : category || query ? (
          <div className="flex flex-col gap-2">
            <ListingRow
              listings={visible}
              label={categoryName ? t("home.categoryDraws", { category: categoryName }) : t("home.matchingDraws")}
            />
            <SeeAllLink
              to={browseHref({
                category,
                q: query || undefined,
                type: "draws",
              })}
              label={t("home.seeAllDrawsCount", { count: visible.length })}
            />
          </div>
        ) : (
          <ByCategory listings={visible} type="draws" />
        )}
      </section>

      {shop.length ? (
        <section
          className="flex flex-col gap-4"
          aria-labelledby="buy-now-heading"
        >
          <div className="flex flex-col gap-1">
            <span className="text-xs font-extrabold tracking-[0.14em] text-brand uppercase">
              {t("home.shopEyebrow")}
            </span>
            <h2
              id="buy-now-heading"
              className="font-display text-2xl font-extrabold tracking-tight"
            >
              {categoryName ? t("home.shopHeadingCategory", { category: categoryName }) : t("home.shopHeading")}
            </h2>
            <p className="text-sm text-muted">
              {t("home.shopBody")}
            </p>
          </div>
          {category || query ? (
            <div className="flex flex-col gap-2">
              <ListingRow
                listings={shop}
                label={categoryName ? t("home.categoryToBuy", { category: categoryName }) : t("home.matchingItems")}
              />
              <SeeAllLink
                to={browseHref({ category, q: query || undefined, type: "buy" })}
                label={t("home.seeAllItems", { count: shop.length })}
              />
            </div>
          ) : (
            <ByCategory listings={shop} type="buy" />
          )}
        </section>
      ) : null}

      {!category && !query ? <WinnersStrip /> : null}

      <section className="flex flex-col gap-4" aria-labelledby="how-heading">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-extrabold tracking-[0.14em] text-brand uppercase">
            {t("regulated.howItWorks")}
          </span>
          <h2
            id="how-heading"
            className="font-display text-2xl font-extrabold tracking-tight"
          >
            {t("regulated.fourSteps")}
          </h2>
        </div>
        <HowItWorksGrid />
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <Link to="/practice" className="flex min-h-11 items-center">
            {t("regulated.practiceLink")}
          </Link>
          <Link to="/draws" className="flex min-h-11 items-center">
            {t("home.seePastResults")}
          </Link>
        </div>
      </section>
    </div>
  );
}

/** A few recent winners who chose to be shown. Nothing at all until there are some. */
function WinnersStrip() {
  const { t } = useTranslation();
  const q = useWinnersWall();
  if (!q.data?.length) return null;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="winners-heading">
      <div className="flex items-center justify-between gap-3">
        <h2
          id="winners-heading"
          className="font-display text-2xl font-extrabold tracking-tight"
        >
          {t("home.recentWinners")}
        </h2>
        <SeeAllLink to="/winners" label={t("home.seeAll")} />
      </div>
      <div className="no-scrollbar -mx-4 flex gap-4 overflow-x-auto px-4 pt-1 pb-3 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
        {q.data.slice(0, 8).map((w) => (
          <WinnerCard
            key={w.id}
            entry={w}
            className="listing-row-item shrink-0"
          />
        ))}
      </div>
    </section>
  );
}

/** One scrolling row per category, in the usual category order. */
function ByCategory({
  listings,
  type,
}: {
  listings: ListingView[];
  type: "draws" | "buy";
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-8">
      {CATEGORIES.map((c) => {
        const items = listings.filter((l) => l.category === c);
        if (!items.length) return null;
        const Icon = CATEGORY_STYLE[c].icon;
        const to = browseHref({ category: c, type });
        const name = t(`categories.${c}`);
        return (
          <div key={c} className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 font-display text-lg font-extrabold">
                <Icon size={18} className="text-brand" /> {name}
                <span className="text-sm font-semibold text-subtle">
                  ({items.length})
                </span>
              </h3>
              <SeeAllLink to={to} label={t("home.allInCategory", { category: name.toLowerCase() })} />
            </div>
            <ListingRow
              listings={items}
              label={type === "draws" ? t("home.categoryDraws", { category: name }) : t("home.categoryToBuy", { category: name })}
            />
          </div>
        );
      })}
    </div>
  );
}

/** Wide photo cards for the highest-value live draws. */
function BigPrizes({ listings }: { listings?: ListingView[] }) {
  const { t } = useTranslation();
  const prizes = (listings ?? [])
    .filter((l) => l.status === "live" && l.images.length > 0)
    .sort((a, b) => b.priceKobo - a.priceKobo)
    .slice(0, 3);
  if (prizes.length < 2) return null;

  return (
    <section className="flex flex-col gap-4" aria-labelledby="prizes-heading">
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-extrabold tracking-[0.14em] text-brand uppercase">
            {t("home.bigPrizesEyebrow")}
          </span>
          <h2
            id="prizes-heading"
            className="font-display text-2xl font-extrabold tracking-tight"
          >
            {t("home.bigPrizesHeading")}
          </h2>
        </div>
        <Link to="/?category=Cars" className="hidden shrink-0 text-sm sm:block">
          {t("home.allCars")}
        </Link>
      </div>
      <div className="no-scrollbar flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 sm:-mx-6 sm:px-6 lg:mx-0 lg:grid lg:grid-cols-3 lg:overflow-visible lg:px-0">
        {prizes.map((l, i) => (
          <Link
            key={l.id}
            to={`/listings/${l.id}`}
            style={{ animationDelay: `${i * 80}ms` }}
            className="group relative isolate flex h-80 w-[88%] shrink-0 animate-fade-up snap-start flex-col justify-end overflow-hidden rounded-4xl bg-hero p-5 text-on-hero no-underline shadow-lift sm:w-[60%] lg:w-auto"
          >
            <img
              src={l.images[0]}
              alt=""
              loading="lazy"
              className="absolute inset-0 -z-20 size-full object-cover object-[50%_60%] transition-transform duration-700 ease-out group-hover:scale-105"
            />
            <div className="absolute inset-0 -z-10 bg-linear-to-t from-hero via-hero/20 to-transparent" />
            <span className="absolute top-4 left-4 rounded-full bg-ticket px-2.5 py-1 text-[11px] font-extrabold text-on-ticket shadow-card">
              {t("card.cheaper", { multiple: valueMultiple(l).toLocaleString("en-NG") })}
            </span>
            <span className="absolute top-4 right-4">
              <Countdown
                closesAt={l.closesAt}
                className="rounded-full bg-ink/60 px-2.5 py-1 text-xs font-bold text-ground backdrop-blur"
              />
            </span>
            <div className="flex flex-col gap-2 text-on-brand-muted">
              <span className="text-xs font-semibold text-on-brand-muted">
                {t("card.worth", { price: formatNaira(l.priceKobo) })}
              </span>
              <strong className="font-display text-2xl leading-tight">
                {l.title}
              </strong>
              <ProgressBar
                value={l.ticketsSold}
                max={l.ticketCount}
                hot={isAlmostGone(l)}
                label={t("home.ticketsSoldFor", { title: l.title })}
                size="sm"
                className="bg-white/20"
              />
              <div className="flex items-center justify-between text-sm">
                <span>
                  <strong className="text-ticket">
                    {formatNaira(l.buyerTicketPriceKobo)}
                  </strong>{" "}
                  {t("card.slashTicket")}
                </span>
                <span className="flex items-center gap-1 font-bold transition group-hover:translate-x-0.5">
                  {t("home.enter")} <ArrowRightIcon size={16} />
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function Hero({
  listings,
  query,
  onQuery,
}: {
  listings?: ListingView[];
  query: string;
  onQuery: (q: string) => void;
}) {
  const { t } = useTranslation();
  const live = listings?.filter((l) => l.status === "live") ?? [];
  const sold = live.reduce((s, l) => s + l.ticketsSold, 0);
  const cheapest = live.length
    ? Math.min(...live.map((l) => l.buyerTicketPriceKobo))
    : null;
  // Spotlight the draw closest to selling out, preferring ones that are almost gone.
  const spotlight = live.find(isAlmostGone) ?? live[0];

  return (
    <section className="relative isolate overflow-hidden rounded-4xl bg-hero text-on-hero shadow-lift">
      <img
        src="/assets/heroBanner-1-1600.jpg"
        srcSet="/assets/heroBanner-1-900.jpg 900w, /assets/heroBanner-1-1600.jpg 1600w"
        sizes="(min-width: 1200px) 1150px, 100vw"
        alt=""
        fetchPriority="high"
        className="absolute inset-0 -z-20 size-full -scale-x-100 object-cover object-[30%_40%]"
      />
      {/* Brand-tinted scrim keeps the copy readable over the photo. */}
      <div className="absolute inset-0 -z-10 bg-linear-to-b from-hero/75 via-hero/90 to-hero lg:bg-linear-to-r lg:from-hero lg:via-hero/50 lg:to-hero/10" />
      <div className="absolute -bottom-32 left-1/4 -z-10 size-80 rounded-full bg-brand/30 blur-3xl" />

      <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[1.25fr_1fr] lg:items-center lg:p-10">
        <div className="flex animate-fade-up flex-col gap-5">
          <span className="flex w-fit items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold ring-1 ring-white/15">
            <ShieldIcon size={15} className="text-ticket" />
            {t("regulated.licenceShort")}
          </span>
          <h1 className="font-display text-[2.6rem] leading-[0.98] font-extrabold tracking-tight sm:text-6xl">
            {t("home.heroTitle")}{" "}
            <span className="relative whitespace-nowrap text-ticket">
              {t("home.heroTitleAccent")}
            </span>
          </h1>
          <p className="max-w-md text-[15px] leading-relaxed text-on-brand-muted">
            {t("home.heroBody")}
          </p>

          <form
            role="search"
            onSubmit={(e) => e.preventDefault()}
            className="relative max-w-md"
          >
            <label htmlFor="search" className="sr-only">
              {t("home.searchProducts")}
            </label>
            <SearchIcon
              size={20}
              className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-subtle"
            />
            <input
              id="search"
              type="search"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder={t("home.searchPlaceholder")}
              className="min-h-14 w-full rounded-2xl border-0 bg-surface pr-4 pl-12 text-base text-ink shadow-lift placeholder:text-subtle focus:ring-4 focus:ring-ticket/50 focus:outline-none"
            />
          </form>

          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-on-brand-muted">
            <li className="flex items-center gap-1.5">
              <LockIcon size={16} className="text-ticket" /> {t("home.checkedBeforeListing")}
            </li>
            <li className="flex items-center gap-1.5">
              <SparklesIcon size={16} className="text-ticket" /> {t("regulated.provablyFair")}
            </li>
            <li className="flex items-center gap-1.5">
              <NairaIcon size={16} className="text-ticket" />{" "}
              {t("regulated.backIfYouLose", { percent: RULES.consolationCreditBps / 100 })}
            </li>
          </ul>
        </div>

        <div className="flex flex-col gap-3">
          {spotlight ? (
            <Link
              to={`/listings/${spotlight.id}`}
              className="group flex animate-fade-up flex-col gap-4 rounded-3xl bg-surface p-4 text-ink no-underline shadow-lift transition hover:-translate-y-1 [animation-delay:120ms] sm:rotate-1 sm:hover:rotate-0"
            >
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-extrabold tracking-wider text-hot-ink uppercase">
                  <FlameIcon size={15} /> {t("home.hotRightNow")}
                </span>
                <Countdown
                  closesAt={spotlight.closesAt}
                  className="text-xs font-bold text-subtle"
                />
              </div>
              <div className="flex gap-4">
                <ProductImage
                  category={spotlight.category}
                  src={spotlight.images[0]}
                  alt={spotlight.title}
                  size="sm"
                  eager
                  className="size-24 shrink-0"
                />
                <div className="flex min-w-0 flex-col justify-center gap-1">
                  <strong className="text-lg leading-tight">
                    {spotlight.title}
                  </strong>
                  <span className="text-xs text-subtle">
                    {t("card.worth", { price: formatNaira(spotlight.priceKobo) })}
                  </span>
                  <span className="text-sm">
                    <strong className="text-brand">
                      {formatNaira(spotlight.buyerTicketPriceKobo)}
                    </strong>{" "}
                    {t("card.perTicket")}
                  </span>
                </div>
              </div>
              <ProgressBar
                value={spotlight.ticketsSold}
                max={spotlight.ticketCount}
                hot={isAlmostGone(spotlight)}
                label={t("home.ticketsSold")}
              />
              <span className={buttonClass("primary", "md", "w-full")}>
                {t("home.ticketsLeftGetYours", { count: (spotlight.ticketCount - spotlight.ticketsSold).toLocaleString("en-NG") as unknown as number })}
              </span>
            </Link>
          ) : (
            <Skeleton className="h-64 bg-white/10" />
          )}
          <dl className="grid animate-fade-up grid-cols-3 gap-2 [animation-delay:200ms]">
            {[
              [t("home.statLiveDraws"), live.length ? String(live.length) : "–"],
              [t("home.statTicketsSold"), sold ? sold.toLocaleString("en-NG") : "–"],
              [t("home.statTicketsFrom"), cheapest ? formatNaira(cheapest) : "–"],
            ].map(([k, v]) => (
              <div
                key={k}
                className="flex flex-col rounded-2xl bg-white/8 p-3 ring-1 ring-white/10"
              >
                <dt className="text-[11px] font-semibold text-on-brand-muted">
                  {k}
                </dt>
                <dd className="font-display text-xl font-extrabold tabular-nums">
                  {v}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
