import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { api } from "@/api";
import {
  useCheckDeposit,
  useDeposit,
  useSetWeeklyLimit,
  useTopUp,
  useWallet,
} from "@/api/hooks";
import type { DepositStatus, WalletView } from "@/api/types";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronRightIcon,
  ClockIcon,
  NairaIcon,
  GaugeIcon,
  GiftIcon,
  PlusIcon,
  RefreshIcon,
  EyeIcon,
  EyeOffIcon,
  SettingsIcon,
  ShieldIcon,
  StoreIcon,
  TicketIcon,
  WalletIcon,
  type IconComponent,
} from "@/components/icons";
import { Sheet } from "@/components/Sheet";
import { useBalanceHidden, useBalanceText } from "@/lib/balanceVisibility";
import { useToast } from "@/components/toast";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Notice,
  PageTitle,
  ProgressBar,
  Segmented,
  Skeleton,
  cx,
  errorMessage,
  inputCls,
} from "@/components/ui";
import { formatNaira, nairaToKobo, parseNairaInput } from "@/domain/money";
import { RULES, topUpError } from "@/domain/rules";
import type { LedgerEntry, LedgerKind } from "@/domain/types";
import { dateTime, dayLabel, timeOfDay } from "@/lib/time";

const TOP_UPS = [nairaToKobo(5_000), nairaToKobo(20_000), nairaToKobo(50_000)];
const LIMIT_PRESETS = [
  nairaToKobo(10_000),
  nairaToKobo(25_000),
  nairaToKobo(50_000),
  nairaToKobo(100_000),
];

/** What to tell the buyer once a payment-provider top-up finishes. */
function depositMessage(
  status: DepositStatus,
  amt: number,
): [string, "success" | "info" | "error"] {
  const provider = api.payments?.provider ?? "the payment provider";
  switch (status) {
    case "successful":
      return [
        `${formatNaira(amt)} added${api.testMode ? " (test payment)" : ""}.`,
        "success",
      ];
    case "pending":
      return [
        `Waiting for ${provider} to confirm. We’ll add ${formatNaira(amt)} as soon as it does.`,
        "info",
      ];
    case "cancelled":
      return ["Top-up cancelled. No money was taken.", "info"];
    case "failed":
      return ["That payment didn’t go through, so nothing was added.", "error"];
  }
}

export function WalletPage() {
  const wallet = useWallet();

  if (wallet.isPending)
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-64" />
        <Skeleton className="h-40" />
        <Skeleton className="h-72" />
      </div>
    );
  if (wallet.isError)
    return <ErrorState error={wallet.error} onRetry={() => wallet.refetch()} />;
  const w = wallet.data;

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        eyebrow="Wallet"
        sub="Top up once, then buy tickets in a tap. Store credit is always spent first."
      >
        Your money
      </PageTitle>

      <div className="grid gap-5 lg:grid-cols-[1fr_380px] lg:items-start">
        <div className="flex min-w-0 flex-col gap-5">
          <BalanceCard w={w} />
          <Activity entries={w.entries} />
        </div>
        <div className="flex flex-col gap-5 lg:sticky lg:top-24">
          <LimitCard
            spent={w.spentThisWeekKobo}
            limit={w.weeklyLimitKobo}
            pending={w.pendingLimit}
          />
          <Link
            to="/account"
            className="flex min-h-14 items-center gap-3 rounded-3xl border border-line bg-surface p-4 text-sm font-bold text-ink no-underline shadow-card transition hover:border-line-strong"
          >
            <SettingsIcon size={20} className="shrink-0 text-muted" />
            Account and settings
            <ChevronRightIcon size={18} className="ml-auto text-subtle" />
          </Link>
        </div>
      </div>
    </div>
  );
}

function BalanceCard({ w }: { w: WalletView }) {
  const topUp = useTopUp();
  const deposit = useDeposit();
  const toast = useToast();
  const [custom, setCustom] = useState(false);
  const [hidden, setHidden] = useBalanceHidden();
  const money = useBalanceText();
  const total = w.balance.cashKobo + w.balance.creditKobo;
  const payments = api.payments;
  const busy = topUp.isPending || deposit.isPending;
  const busyAmount = topUp.isPending
    ? topUp.variables
    : deposit.isPending
      ? deposit.variables
      : undefined;

  function add(amt: number) {
    const onError = (e: unknown) => toast(errorMessage(e), "error");
    if (payments) {
      setCustom(false); // the provider's checkout opens on top
      deposit.mutate(amt, {
        onSuccess: (status) => toast(...depositMessage(status, amt)),
        onError,
      });
    } else {
      topUp.mutate(amt, {
        onSuccess: () => {
          toast(
            `${formatNaira(amt)} added${api.testMode ? " (test money)" : ""}.`,
          );
          setCustom(false);
        },
        onError,
      });
    }
  }

  return (
    <section className="relative isolate flex animate-fade-up flex-col gap-5 overflow-hidden rounded-4xl bg-linear-to-br from-hero via-hero to-hero-2 p-6 text-on-hero shadow-lift sm:p-7">
      <div className="texture-dots absolute inset-0 -z-10" />
      <div className="absolute -top-16 -right-16 -z-10 size-56 rounded-full bg-ticket/20 blur-3xl" />

      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col">
          <span className="flex items-center gap-1 text-xs font-semibold text-on-brand-muted">
            Available to spend
            <button
              type="button"
              onClick={() => setHidden(!hidden)}
              aria-pressed={hidden}
              aria-label={hidden ? "Show your balance" : "Hide your balance"}
              title={hidden ? "Show your balance" : "Hide your balance"}
              className="-my-3 flex size-11 cursor-pointer items-center justify-center rounded-xl text-on-hero transition hover:bg-white/10"
            >
              {hidden ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
            </button>
          </span>
          <span
            key={`${total}-${hidden}`}
            className="animate-fade-in font-display text-5xl font-extrabold tracking-tight tabular-nums"
          >
            {money(total)}
          </span>
        </div>
        <span className="flex size-12 items-center justify-center rounded-2xl bg-white/10 text-ticket ring-1 ring-white/15">
          <WalletIcon size={24} />
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col rounded-2xl bg-white/8 p-3 ring-1 ring-white/10">
          <span className="text-[11px] font-semibold text-on-brand-muted">
            Cash
          </span>
          <span className="text-lg font-extrabold tabular-nums">
            {money(w.balance.cashKobo)}
          </span>
        </div>
        <div className="flex flex-col rounded-2xl bg-ticket/15 p-3 ring-1 ring-ticket/30">
          <span className="flex items-center gap-1 text-[11px] font-semibold text-ticket">
            <NairaIcon size={12} /> Store credit
          </span>
          <span className="text-lg font-extrabold text-ticket tabular-nums">
            {money(w.balance.creditKobo)}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-bold text-on-brand-muted">
          Quick top-up
        </span>
        <div className="grid grid-cols-4 gap-2">
          {TOP_UPS.map((amt) => (
            <Button
              key={amt}
              variant="ticket"
              className="px-2"
              loading={busyAmount === amt}
              disabled={busy}
              onClick={() => add(amt)}
            >
              +{formatNaira(amt).replace(",000", "k")}
            </Button>
          ))}
          <button
            onClick={() => setCustom(true)}
            disabled={busy}
            className="flex min-h-11 items-center justify-center gap-1 rounded-xl bg-white/10 text-sm font-bold ring-1 ring-white/20 transition hover:bg-white/20 disabled:opacity-60"
          >
            <PlusIcon size={16} /> Other
          </button>
        </div>
      </div>
      {payments && w.pendingDeposits.length ? (
        <PendingDeposits
          deposits={w.pendingDeposits}
          provider={payments.provider}
        />
      ) : null}

      {payments ? (
        <span className="flex items-start gap-1.5 text-[11px] text-on-brand-muted">
          <ShieldIcon size={14} className="mt-px shrink-0 text-ticket" />
          {api.testMode
            ? `Card, bank transfer or USSD through ${payments.provider}’s test checkout. Test mode: use their test cards; no real money moves.`
            : `Card, bank transfer or USSD. Payments are processed securely by ${payments.provider}; DrawMart never sees your card details.`}
        </span>
      ) : (
        <span className="text-[11px] text-on-brand-muted">
          {api.testMode
            ? "Test mode: no real money moves. The live version tops up by bank transfer or card."
            : "Top up by bank transfer or card."}
        </span>
      )}

      <CustomTopUp
        open={custom}
        onClose={() => setCustom(false)}
        onAdd={add}
        loading={busy}
      />
    </section>
  );
}

/** Paid top-ups still waiting on the provider, e.g. a bank transfer on its way. */
function PendingDeposits({
  deposits,
  provider,
}: {
  deposits: WalletView["pendingDeposits"];
  provider: string;
}) {
  const check = useCheckDeposit();
  const toast = useToast();
  return (
    <ul
      className="flex flex-col gap-2 rounded-2xl bg-white/8 p-3 ring-1 ring-white/10"
      aria-label="Top-ups waiting for confirmation"
    >
      {deposits.map((d) => (
        <li key={d.txRef} className="flex items-center gap-3 text-sm">
          <ClockIcon size={18} className="shrink-0 text-ticket" />
          <span className="min-w-0 flex-1 leading-snug">
            <strong className="tabular-nums">
              {formatNaira(d.amountKobo)}
            </strong>{" "}
            waiting for {provider}
            <span className="block text-[11px] text-on-brand-muted">
              Started {timeOfDay(d.createdAt)}. Added automatically once
              confirmed.
            </span>
          </span>
          <button
            onClick={() =>
              check.mutate(d.txRef, {
                onSuccess: (status) =>
                  status === "pending"
                    ? toast(
                        `Still waiting for ${provider}. Nothing to do; it’s added automatically.`,
                        "info",
                      )
                    : toast(...depositMessage(status, d.amountKobo)),
                onError: (e) => toast(errorMessage(e), "error"),
              })
            }
            disabled={check.isPending}
            className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl bg-white/10 px-3 text-xs font-bold ring-1 ring-white/20 transition hover:bg-white/20 disabled:opacity-60"
          >
            <RefreshIcon
              size={14}
              className={
                check.isPending && check.variables === d.txRef
                  ? "animate-spin"
                  : undefined
              }
            />
            Check now
          </button>
        </li>
      ))}
    </ul>
  );
}

function CustomTopUp({
  open,
  onClose,
  onAdd,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (amt: number) => void;
  loading: boolean;
}) {
  const [value, setValue] = useState("");
  const amount = parseNairaInput(value);
  const problem = value.trim() ? topUpError(amount) : null;
  const limits = `${formatNaira(RULES.minTopUpKobo)} to ${formatNaira(RULES.maxTopUpKobo)} per top-up.`;
  return (
    <Sheet open={open} onClose={onClose} title="Top up wallet">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!topUpError(amount)) onAdd(amount);
        }}
      >
        <h2 className="pr-10 font-display text-2xl font-extrabold">
          Top up your wallet
        </h2>
        <Field
          label="Amount (₦)"
          htmlFor="topup-amount"
          error={problem ?? undefined}
          hint={api.testMode ? `${limits} Test money only.` : limits}
        >
          <input
            id="topup-amount"
            inputMode="numeric"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. 15,000"
            className={cx(
              inputCls,
              "min-h-14 font-display text-2xl font-extrabold",
            )}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          {[1_000, 2_500, 10_000, 100_000].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setValue(n.toLocaleString("en-NG"))}
              className="min-h-11 rounded-xl border border-line-strong px-3 text-sm font-bold hover:border-ink/40"
            >
              {formatNaira(nairaToKobo(n))}
            </button>
          ))}
        </div>
        <Button
          type="submit"
          size="lg"
          loading={loading}
          disabled={amount <= 0 || !!problem}
        >
          {amount <= 0
            ? "Enter an amount"
            : api.payments
              ? `Pay ${formatNaira(amount)}`
              : `Add ${formatNaira(amount)}`}
        </Button>
        {api.payments ? (
          <span className="flex items-center justify-center gap-1.5 text-xs text-subtle">
            <ShieldIcon size={14} className="text-brand" /> Secure checkout by{" "}
            {api.payments.provider}
          </span>
        ) : null}
      </form>
    </Sheet>
  );
}

function LimitCard({
  spent,
  limit,
  pending,
}: {
  spent: number;
  limit: number;
  pending: WalletView["pendingLimit"];
}) {
  const setLimit = useSetWeeklyLimit();
  const toast = useToast();
  const [value, setValue] = useState("");
  const pct = limit ? Math.min(100, Math.round((spent / limit) * 100)) : 0;

  function submit(amount: number) {
    setLimit.mutate(amount, {
      onSuccess: () => {
        setValue("");
        toast(
          amount <= limit
            ? "Limit lowered. It applies right away."
            : `Your new limit starts in ${RULES.limitIncreaseDelayHours} hours.`,
          amount <= limit ? "success" : "info",
        );
      },
      onError: (err) => toast(errorMessage(err), "error"),
    });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    submit(parseNairaInput(value));
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-violet-soft text-violet">
          <GaugeIcon size={20} />
        </span>
        <div className="flex flex-col">
          <strong>Weekly spending limit</strong>
          <span className="text-xs text-subtle">
            Play responsibly. You’re in control.
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-display text-2xl font-extrabold tabular-nums">
            {formatNaira(spent)}
          </span>
          <span className="text-subtle">of {formatNaira(limit)}</span>
        </div>
        <ProgressBar
          value={spent}
          max={limit}
          hot={pct >= 80}
          label="Spent this week"
        />
        <span className="text-xs text-subtle">
          {formatNaira(Math.max(0, limit - spent))} left this week
        </span>
      </div>
      {pending ? (
        <Notice tone="sky" icon={RefreshIcon}>
          Rising to <strong>{formatNaira(pending.amountKobo)}</strong> on{" "}
          {dateTime(pending.effectiveAt)}.
        </Notice>
      ) : null}
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="Quick limits"
      >
        {LIMIT_PRESETS.map((amt) => (
          <button
            key={amt}
            onClick={() => submit(amt)}
            disabled={setLimit.isPending || amt === limit}
            aria-pressed={amt === limit}
            className={cx(
              "min-h-11 flex-1 rounded-xl border px-2 text-xs font-bold transition disabled:cursor-default",
              amt === limit
                ? "border-brand bg-brand-soft text-brand-ink"
                : "border-line-strong hover:border-ink/40",
            )}
          >
            {formatNaira(amt).replace(",000", "k")}
          </button>
        ))}
      </div>
      <form onSubmit={onSubmit} className="flex gap-2">
        <label htmlFor="limit" className="sr-only">
          New weekly limit in naira
        </label>
        <input
          id="limit"
          inputMode="numeric"
          placeholder="Custom limit, e.g. 30,000"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className={cx(inputCls, "min-w-0 flex-1")}
        />
        <Button
          type="submit"
          variant="outline"
          loading={setLimit.isPending}
          disabled={!parseNairaInput(value)}
        >
          Set
        </Button>
      </form>
      <p className="text-xs text-subtle">
        Lowering your limit takes effect now. Raising it waits{" "}
        {RULES.limitIncreaseDelayHours} hours.
      </p>
    </Card>
  );
}

type ActivityFilter = "all" | "in" | "out";

const KIND: Record<LedgerKind, { icon: IconComponent; tone: string }> = {
  topup: { icon: ArrowDownIcon, tone: "bg-brand-soft text-brand-ink" },
  ticket_purchase: { icon: TicketIcon, tone: "bg-sunken text-muted" },
  refund: { icon: RefreshIcon, tone: "bg-sky-soft text-sky" },
  store_credit: { icon: GiftIcon, tone: "bg-ticket-soft text-ticket-ink" },
  order_payment: { icon: StoreIcon, tone: "bg-sunken text-muted" },
  adjustment: { icon: ArrowUpIcon, tone: "bg-violet-soft text-violet" },
};

function Activity({ entries }: { entries: LedgerEntry[] }) {
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const amount = (e: LedgerEntry) => e.cashKobo + e.creditKobo;
  const shown = entries.filter((e) =>
    filter === "in" ? amount(e) > 0 : filter === "out" ? amount(e) < 0 : true,
  );

  // Group by day, keeping newest first.
  const groups: { day: string; items: LedgerEntry[] }[] = [];
  for (const e of shown) {
    const day = dayLabel(e.createdAt);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.items.push(e);
    else groups.push({ day, items: [e] });
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl font-extrabold">Activity</h2>
        <Segmented<ActivityFilter>
          label="Filter activity"
          value={filter}
          onChange={setFilter}
          size="sm"
          options={[
            { value: "all", label: "All" },
            { value: "in", label: "Money in" },
            { value: "out", label: "Spent" },
          ]}
        />
      </div>
      {groups.length === 0 ? (
        <EmptyState
          icon={WalletIcon}
          title="Nothing here yet"
          body="Top-ups, tickets, refunds and credit will show up here."
        />
      ) : (
        <Card className="overflow-hidden">
          {groups.map((g) => (
            <div key={g.day}>
              <div className="sticky top-0 not-first:top-16 z-10 border-b border-line bg-sunken/80 px-5 py-2 text-xs font-extrabold tracking-wide text-subtle uppercase backdrop-blur">
                {g.day}
              </div>
              <ul className="divide-y divide-line">
                {g.items.map((e) => {
                  const amt = amount(e);
                  const k = KIND[e.kind];
                  return (
                    <li
                      key={e.id}
                      className="flex items-center gap-3 px-5 py-3.5 text-sm"
                    >
                      <span
                        className={cx(
                          "flex size-10 shrink-0 items-center justify-center rounded-xl",
                          k.tone,
                        )}
                      >
                        <k.icon size={18} />
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate font-semibold">{e.memo}</span>
                        <span className="text-[11px] text-subtle">
                          {timeOfDay(e.createdAt)}
                          {e.creditKobo !== 0 && e.cashKobo !== 0
                            ? ` · ${formatNaira(Math.abs(e.creditKobo))} in credit`
                            : e.creditKobo !== 0
                              ? " · store credit"
                              : ""}
                        </span>
                      </div>
                      <strong
                        className={cx(
                          "shrink-0 tabular-nums",
                          amt > 0 ? "text-brand" : "text-ink",
                        )}
                      >
                        {formatNaira(amt, { signed: true })}
                      </strong>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </Card>
      )}
    </section>
  );
}
