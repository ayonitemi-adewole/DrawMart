import { PrizeActions } from "@/components/PrizeActions";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { useListing, useMarkWinCelebrated, useUncelebratedWins } from "@/api/hooks";
import type { DrawResultView } from "@/api/types";
import { Confetti } from "@/components/Confetti";
import { CopyButton } from "@/components/CopyButton";
import {
  CheckIcon,
  NairaIcon,
  HashIcon,
  LockIcon,
  PlayIcon,
  RefreshIcon,
  ShieldIcon,
  TicketIcon,
  TrophyIcon,
  UnlockIcon,
  XIcon,
  type IconComponent,
} from "@/components/icons";
import { TicketStub } from "@/components/TicketStub";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  ProductImage,
  Skeleton,
  Spinner,
  buttonClass,
  cx,
} from "@/components/ui";
import { drawHash, verifyDraw, type VerifyOutcome } from "@/domain/draw";
import { formatNaira } from "@/domain/money";
import type { Category } from "@/domain/types";
import { dateTime, ticketNo } from "@/lib/time";

export function ResultPage() {
  const { id = "" } = useParams();
  const q = useListing(id);

  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError)
    return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const l = q.data;
  if (!l.result) {
    return (
      <EmptyState
        icon={LockIcon}
        title={l.status === "sold_out" ? "All tickets sold. Winner coming soon" : "This draw hasn’t run yet"}
        body={
          l.status === "sold_out" && l.drawAt
            ? `The winner will be announced on ${dateTime(l.drawAt)}. The result and the proof will be published here.`
            : "Once the last ticket sells, the winner is announced on the deadline, or within 7 days if that’s sooner."
        }
        action={
          <Link to={`/listings/${l.id}`} className={buttonClass("primary")}>
            Back to the listing
          </Link>
        }
      />
    );
  }
  return (
    <Result
      listingId={l.id}
      title={l.title}
      category={l.category}
      image={l.images[0]}
      priceKobo={l.priceKobo}
      r={l.result}
    />
  );
}

const revealKey = (id: string) => `drawmart:revealed:${id}`;
const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function alreadyRevealed(id: string) {
  try {
    return (
      sessionStorage.getItem(revealKey(id)) === "1" || prefersReducedMotion()
    );
  } catch {
    return true;
  }
}

/** Rolls random ticket numbers, slowing down, then lands on the winner. */
function useReveal(id: string, ticketCount: number, winner: number, announced: boolean) {
  const [rolling, setRolling] = useState(() => !announced && !alreadyRevealed(id));
  const [shown, setShown] = useState(winner);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!rolling) return;
    let delay = 45;
    const tick = () => {
      setShown(1 + Math.floor(Math.random() * ticketCount));
      delay *= 1.13;
      if (delay > 380) {
        setShown(winner);
        setRolling(false);
        try {
          sessionStorage.setItem(revealKey(id), "1");
        } catch {
          /* ignore */
        }
        return;
      }
      timer.current = setTimeout(tick, delay);
    };
    timer.current = setTimeout(tick, 400);
    return () => clearTimeout(timer.current);
  }, [rolling, id, ticketCount, winner]);

  function skip() {
    clearTimeout(timer.current);
    setShown(winner);
    setRolling(false);
  }

  return { rolling, shown, replay: () => setRolling(true), skip };
}

function Result({
  listingId,
  title,
  category,
  image,
  priceKobo,
  r,
}: {
  listingId: string;
  title: string;
  category: Category;
  image?: string;
  priceKobo: number;
  r: DrawResultView;
}) {
  // Coming from the win pop-up, so there's no suspense left to build.
  const announced = !!(useLocation().state as { announced?: boolean } | null)?.announced;
  const { rolling, shown, replay, skip } = useReveal(
    listingId,
    r.ticketCount,
    r.winningNumber,
    announced,
  );
  const played = r.myNumbers.length > 0;
  const celebrate = !rolling && r.iWon;

  // Seeing the win here counts: the pop-up shouldn't announce it afterwards.
  const unannounced = useUncelebratedWins().some((n) => n.listingId === listingId);
  const { mutate: markCelebrated } = useMarkWinCelebrated();
  useEffect(() => {
    if (celebrate && unannounced) markCelebrated(listingId);
  }, [celebrate, unannounced, listingId, markCelebrated]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      {celebrate ? <Confetti /> : null}

      <section
        className={cx(
          "relative isolate flex flex-col items-center gap-5 overflow-hidden rounded-4xl px-6 py-8 text-center shadow-lift transition-colors duration-700",
          celebrate
            ? "bg-linear-to-br from-ticket to-hot text-on-ticket"
            : "bg-linear-to-br from-hero to-hero-2 text-on-hero",
        )}
      >
        <div className="texture-dots absolute inset-0 -z-10" />
        <span className="flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-xs font-extrabold tracking-[0.15em] ring-1 ring-white/20">
          {rolling ? <Spinner className="size-3" /> : <TrophyIcon size={14} />}
          {rolling ? "DRAWING…" : r.iWon ? "YOU WON" : "DRAW COMPLETE"}
        </span>

        <div className="flex flex-col items-center gap-1">
          <span className="text-sm font-semibold opacity-80">
            Winning ticket
          </span>
          <span
            aria-live="polite"
            aria-busy={rolling}
            className={cx(
              "rounded-3xl bg-white/12 px-6 py-3 font-mono text-6xl font-extrabold tracking-tight tabular-nums ring-1 ring-white/20 sm:text-7xl",
              !rolling && "animate-pop",
            )}
          >
            {rolling ? ticketNo(shown) : ticketNo(r.winningNumber)}
          </span>
          <span className="text-xs opacity-70">
            of {r.ticketCount.toLocaleString("en-NG")} tickets
          </span>
        </div>

        {!rolling ? (
          <div className="flex animate-fade-up flex-col items-center gap-2">
            <h1 className="font-display text-2xl leading-tight font-extrabold sm:text-3xl">
              {r.iWon ? `You won ${title}!` : title}
            </h1>
            <p className="max-w-md text-sm leading-relaxed opacity-90">
              {r.iWon
                ? "Add it to your cart to come with anything else you buy, or arrange it now. You can have it delivered or collect it."
                : played
                  ? `Not this time. ${formatNaira(r.myCreditKobo)} store credit has been added to your wallet.`
                  : "You didn’t have tickets in this draw."}
            </p>
            {r.iWon && !rolling ? <PrizeActions listingId={listingId} /> : null}
          </div>
        ) : (
          <p className="text-sm opacity-80">
            Picking the winner from the revealed secret…
          </p>
        )}

        <div className="flex gap-2">
          {rolling ? (
            <button
              onClick={skip}
              className="min-h-11 rounded-xl bg-white/15 px-4 text-sm font-bold ring-1 ring-white/20 hover:bg-white/25"
            >
              Skip animation
            </button>
          ) : (
            <button
              onClick={replay}
              className="flex min-h-11 items-center gap-1.5 rounded-xl bg-white/15 px-4 text-sm font-bold ring-1 ring-white/20 hover:bg-white/25"
            >
              <PlayIcon size={14} /> Replay draw
            </button>
          )}
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-[1fr_1fr]">
        <Card className="flex items-center gap-4 p-4">
          <ProductImage
            category={category}
            src={image}
            alt={title}
            size="sm"
            className="size-24 shrink-0"
          />
          <div className="flex min-w-0 flex-col">
            <strong className="leading-tight">{title}</strong>
            <span className="text-xs text-subtle">
              Worth {formatNaira(priceKobo)}
            </span>
            <span className="text-xs text-subtle">
              Drawn {dateTime(r.drawnAt)}
            </span>
          </div>
        </Card>
        {played ? (
          <Card className="flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between">
              <strong className="flex items-center gap-2 text-sm">
                <TicketIcon size={16} className="text-brand" /> Your tickets (
                {r.myNumbers.length})
              </strong>
              {!r.iWon && r.myCreditKobo > 0 ? (
                <span className="flex items-center gap-1 text-xs font-bold text-ticket-ink">
                  <NairaIcon size={14} /> +{formatNaira(r.myCreditKobo)}
                </span>
              ) : null}
            </div>
            <div className="flex max-h-28 flex-wrap gap-2 overflow-y-auto px-1.5 py-0.5">
              {r.myNumbers.map((n) => (
                <TicketStub
                  key={n}
                  number={n}
                  size="sm"
                  state={
                    rolling
                      ? "default"
                      : n === r.winningNumber
                        ? "winner"
                        : "lost"
                  }
                />
              ))}
            </div>
          </Card>
        ) : (
          <Card className="flex flex-col justify-center gap-2 p-4">
            <span className="text-sm text-muted">
              Want a shot at the next one?
            </span>
            <Link to="/" className={buttonClass("primary", "md", "self-start")}>
              <span className="text-on-brand">Browse live draws</span>
            </Link>
          </Card>
        )}
      </div>

      <Verify r={r} />

      <div className="flex flex-col gap-2 sm:flex-row">
        <Link to="/" className={buttonClass("primary", "lg", "flex-1")}>
          <span className="text-on-brand">Back to live draws</span>
        </Link>
        <Link to="/draws" className={buttonClass("outline", "lg", "flex-1")}>
          All results
        </Link>
      </div>
    </div>
  );
}

type StepState = "idle" | "checking" | "ok" | "fail";

function Verify({ r }: { r: DrawResultView }) {
  const [check, setCheck] = useState<(VerifyOutcome & { hash: string }) | null>(
    null,
  );
  const [steps, setSteps] = useState<StepState[]>(["idle", "idle", "idle"]);
  const running = steps.includes("checking");

  async function run() {
    setCheck(null);
    setSteps(["checking", "idle", "idle"]);
    const [outcome, hash] = await Promise.all([
      verifyDraw({
        commitment: r.commitment,
        seed: r.seed,
        closingRef: r.closingRef,
        ticketCount: r.ticketCount,
        claimedWinner: r.winningNumber,
      }),
      drawHash(r.seed, r.closingRef),
    ]);
    // Reveal each check in turn so people can follow along.
    const wait = (ms: number) =>
      new Promise((res) => setTimeout(res, prefersReducedMotion() ? 0 : ms));
    await wait(500);
    setSteps([outcome.commitmentMatches ? "ok" : "fail", "checking", "idle"]);
    await wait(500);
    setSteps([outcome.commitmentMatches ? "ok" : "fail", "ok", "checking"]);
    await wait(500);
    setSteps([
      outcome.commitmentMatches ? "ok" : "fail",
      "ok",
      outcome.winnerMatches ? "ok" : "fail",
    ]);
    setCheck({ ...outcome, hash });
  }

  return (
    <Card className="flex flex-col gap-5 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-1.5 text-xs font-extrabold tracking-[0.14em] text-brand uppercase">
            <ShieldIcon size={14} /> Provably fair
          </span>
          <h2 className="font-display text-2xl font-extrabold">
            Check this draw yourself
          </h2>
          <p className="max-w-md text-sm text-muted">
            Everything you need is below. The check runs in your browser, not on
            our servers.
          </p>
        </div>
        <Button
          onClick={run}
          loading={running}
          variant={check?.valid ? "soft" : "primary"}
        >
          {check ? <RefreshIcon size={16} /> : null}
          {check ? "Run again" : "Verify now"}
        </Button>
      </div>

      <ol className="flex flex-col">
        <Step
          n={1}
          icon={LockIcon}
          state={steps[0]}
          title="Lock published before sales"
          sub="SHA-256(secret)"
          value={r.commitment}
        />
        <Step
          n={2}
          icon={UnlockIcon}
          state={steps[1]}
          title="Secret, revealed after the draw"
          value={r.seed}
        />
        <Step
          n={3}
          icon={HashIcon}
          state={steps[2]}
          title="Reference of the purchase that sold the last ticket"
          value={r.closingRef}
          last
        />
      </ol>

      <div className="rounded-2xl bg-ground p-4 font-mono text-xs leading-relaxed break-all text-muted">
        winner = SHA-256(secret + ":" + reference) mod {r.ticketCount} + 1
      </div>

      {check ? (
        <div
          className={cx(
            "flex animate-fade-up flex-col gap-2 rounded-2xl p-4 text-sm",
            check.valid
              ? "bg-brand-soft text-brand-ink"
              : "bg-hot-soft text-hot-ink",
          )}
        >
          <Row
            ok={check.commitmentMatches}
            text={
              check.commitmentMatches
                ? "The secret matches the lock published before sales."
                : "The secret does NOT match the lock."
            }
          />
          <Row
            ok={check.winnerMatches}
            text={`Calculated winner: ${ticketNo(check.computedWinner)} ${check.winnerMatches ? "(matches the announced winner)" : `(we announced ${ticketNo(r.winningNumber)})`}`}
          />
          <code className="mt-1 text-[11px] break-all opacity-75">
            hash {check.hash}
          </code>
        </div>
      ) : null}
    </Card>
  );
}

function Step({
  n,
  icon: Icon,
  state,
  title,
  sub,
  value,
  last,
}: {
  n: number;
  icon: IconComponent;
  state: StepState;
  title: string;
  sub?: string;
  value: string;
  last?: boolean;
}) {
  return (
    <li className="relative flex gap-4 pb-5 last:pb-0">
      {!last ? (
        <span
          className="absolute top-11 bottom-0 left-5.25 w-0.5 bg-line"
          aria-hidden="true"
        />
      ) : null}
      <span
        className={cx(
          "relative flex size-11 shrink-0 items-center justify-center rounded-2xl transition",
          state === "ok"
            ? "bg-brand text-on-brand"
            : state === "fail"
              ? "bg-hot text-white"
              : state === "checking"
                ? "bg-ticket text-on-ticket"
                : "bg-sunken text-muted",
        )}
        aria-label={`Step ${n}${state === "ok" ? ", verified" : state === "fail" ? ", failed" : ""}`}
      >
        {state === "checking" ? (
          <Spinner />
        ) : state === "ok" ? (
          <CheckIcon size={20} />
        ) : state === "fail" ? (
          <XIcon size={20} />
        ) : (
          <Icon size={20} />
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-sm font-bold">
          {title}{" "}
          {sub ? (
            <span className="font-mono text-xs font-normal text-subtle">
              {sub}
            </span>
          ) : null}
        </span>
        <div className="flex items-center gap-1 rounded-xl bg-ground py-0.5 pr-0.5 pl-3">
          <code className="min-w-0 flex-1 truncate font-mono text-xs">
            {value}
          </code>
          <CopyButton value={value} label={title.toLowerCase()} />
        </div>
      </div>
    </li>
  );
}

function Row({ ok, text }: { ok: boolean; text: string }) {
  return (
    <span className="flex items-start gap-2 font-semibold">
      {ok ? (
        <CheckIcon size={18} className="shrink-0" />
      ) : (
        <XIcon size={18} className="shrink-0" />
      )}
      {text}
    </span>
  );
}
