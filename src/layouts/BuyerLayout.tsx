import {
  Link,
  NavLink,
  Navigate,
  Outlet,
  ScrollRestoration,
  useLocation,
  useNavigate,
} from "react-router";
import {
  useAccess,
  useCart,
  useMyListings,
  useSignOut,
  useUnreadMessages,
  useUnreadNotifications,
  useWallet,
} from "@/api/hooks";
import { api } from "@/api";
import { IntroSheet } from "@/components/HowItWorks";
import { NavMenu, type MenuLink } from "@/components/NavMenu";
import {
  BellIcon,
  CartIcon,
  ChatIcon,
  ChevronRightIcon,
  HomeIcon,
  LogoMark,
  ShieldIcon,
  StoreIcon,
  TicketIcon,
  TrophyIcon,
  UserIcon,
  WalletIcon,
} from "@/components/icons";
import { ThemeToggle } from "@/components/ThemeToggle";
import { WinCelebration } from "@/components/WinCelebration";
import { buttonClass, cx } from "@/components/ui";
import { formatNaira } from "@/domain/money";
import { APP_HOME } from "@/lib/apps";
import { useBalanceHidden, useBalanceText } from "@/lib/balanceVisibility";

const NAV = [
  { to: "/", label: "Explore", icon: HomeIcon, end: true },
  { to: "/tickets", label: "Tickets", icon: TicketIcon },
  { to: "/draws", label: "Results", icon: TrophyIcon },
  { to: "/sell", label: "Sell", icon: StoreIcon },
];

/** Phones and tablets: Sell is in the menu. */
const BOTTOM_NAV = [
  { to: "/", label: "Explore", icon: HomeIcon, end: true },
  { to: "/tickets", label: "Tickets", icon: TicketIcon },
  { to: "/draws", label: "Results", icon: TrophyIcon },
  { to: "/messages", label: "Messages", icon: ChatIcon },
];

export function Logo({ suffix, to = "/" }: { suffix?: string; to?: string }) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-2 text-ink no-underline"
      aria-label={`DrawMart${suffix ? " " + suffix : ""} home`}
    >
      <span className="flex size-9 -rotate-6 items-center justify-center rounded-xl bg-linear-to-br from-brand to-hero text-ticket shadow-glow transition group-hover:rotate-0">
        <LogoMark size={20} strokeWidth={2.4} />
      </span>
      <span className="font-display text-[21px] font-extrabold tracking-tight">
        Draw<span className="text-brand">Mart</span>
        {suffix ? (
          <span className="ml-1 text-sm font-semibold text-subtle">
            {suffix}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

export function TestModeBanner() {
  if (!api.testMode) return null;
  return (
    <div className="flex items-center justify-center gap-2 bg-ticket px-4 py-1.5 text-center text-xs font-bold text-on-ticket">
      <span className="rounded-full bg-on-ticket px-1.5 py-px text-[10px] tracking-wider text-ticket">
        TEST
      </span>
      {api.demoReset
        ? "No real money. Data is stored in this browser only."
        : "No real money. Test accounts and test money only."}
    </div>
  );
}

/** The wallet balance, as a chip in the top bar and in the menu. */
function WalletChip({
  cash,
  credit,
  className,
  showArrow,
}: {
  cash: number | null;
  credit: number;
  className?: string;
  /** In the menu, where it needs to look like the link it is. */
  showArrow?: boolean;
}) {
  const [hidden] = useBalanceHidden();
  const money = useBalanceText();
  return (
    <Link
      to="/wallet"
      aria-label={
        hidden
          ? "Wallet: balance hidden"
          : `Wallet: ${cash === null ? "loading" : formatNaira(cash)} cash${credit ? `, ${formatNaira(credit)} credit` : ""}`
      }
      className={cx(
        "items-center gap-2 rounded-2xl bg-ink py-1 pr-3.5 pl-1.5 text-sm font-extrabold text-ground no-underline shadow-card transition hover:opacity-90",
        className,
      )}
    >
      <span className="flex size-8 items-center justify-center rounded-xl bg-ticket text-on-ticket">
        <WalletIcon size={16} />
      </span>
      <span className="flex flex-col leading-none">
        <span className="tabular-nums">
          {cash === null ? "…" : money(cash)}
        </span>
        {credit > 0 ? (
          <span className="mt-0.5 text-[10px] font-bold text-ticket">
            +{money(credit)} credit
          </span>
        ) : null}
      </span>
      {showArrow ? (
        <span className="ml-auto flex items-center gap-1 text-xs font-bold">
          Wallet <ChevronRightIcon size={16} />
        </span>
      ) : null}
    </Link>
  );
}

function useActiveTicketCount() {
  const q = useMyListings();
  return q.data?.filter((l) => l.status === "live").length ?? 0;
}

export function BuyerLayout() {
  const wallet = useWallet();
  const access = useAccess();
  const { pathname, search } = useLocation();
  const active = useActiveTicketCount();
  const unread = useUnreadMessages();
  const unreadNotifications = useUnreadNotifications();
  const cartCount = useCart().data?.length ?? 0;
  const cash = wallet.data?.balance.cashKobo ?? null;
  const credit = wallet.data?.balance.creditKobo ?? 0;
  const navigate = useNavigate();
  const signOut = useSignOut();
  const menuLinks: MenuLink[] = access.signedIn
    ? [
        { to: "/account", label: "Account", icon: UserIcon },
        { to: "/notifications", label: "Notifications", icon: BellIcon, count: unreadNotifications },
        { to: "/sell", label: "Sell", icon: StoreIcon },
      ]
    : [{ to: "/sell", label: "Sell", icon: StoreIcon }];

  // Store and admin accounts have their own apps and never see this one.
  if (access.role && access.role !== "buyer")
    return <Navigate to={APP_HOME[access.role]} replace />;

  return (
    <div className="flex min-h-dvh flex-col">
      <TestModeBanner />
      <header className="sticky top-0 z-30 border-b border-line/70 bg-ground/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          <Logo />
          <nav
            className="hidden items-center gap-1 rounded-2xl bg-sunken/70 p-1 lg:flex"
            aria-label="Main"
          >
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  cx(
                    "relative flex min-h-10 items-center gap-1.5 rounded-xl px-3.5 text-sm font-bold no-underline transition",
                    isActive
                      ? "bg-surface text-ink shadow-card"
                      : "text-muted hover:text-ink",
                  )
                }
              >
                <n.icon size={17} />
                {n.label}
                {n.to === "/tickets" && active > 0 ? (
                  <span className="flex size-5 items-center justify-center rounded-full bg-brand text-[10px] text-on-brand">
                    {active}
                  </span>
                ) : null}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-1">
            {access.signedIn ? (
              <Link
                to="/cart"
                aria-label={cartCount ? `Cart, ${cartCount} ${cartCount === 1 ? "item" : "items"}` : "Cart"}
                className="relative flex size-11 items-center justify-center rounded-xl text-muted no-underline hover:bg-sunken hover:text-ink"
              >
                <CartIcon size={20} />
                {cartCount ? (
                  <span className="absolute top-1.5 right-1.5 flex size-4.5 items-center justify-center rounded-full bg-brand text-[9px] font-extrabold text-on-brand">
                    {cartCount > 9 ? "9+" : cartCount}
                  </span>
                ) : null}
              </Link>
            ) : null}
            {/* Below lg these two and the theme live in the menu. */}
            {access.signedIn ? (
              <Link
                to="/notifications"
                aria-label={unreadNotifications ? `Notifications, ${unreadNotifications} unread` : "Notifications"}
                className="relative hidden size-11 items-center lg:flex justify-center rounded-xl text-muted no-underline hover:bg-sunken hover:text-ink"
              >
                <BellIcon size={20} />
                {unreadNotifications ? (
                  <span className="absolute top-1.5 right-1.5 flex size-4.5 items-center justify-center rounded-full bg-hot text-[9px] font-extrabold text-white">
                    {unreadNotifications > 9 ? "9+" : unreadNotifications}
                  </span>
                ) : null}
              </Link>
            ) : null}
            {access.signedIn ? (
              <Link
                to="/messages"
                aria-label={unread ? `Messages, ${unread} unread` : "Messages"}
                className="relative hidden size-11 items-center lg:flex justify-center rounded-xl text-muted no-underline hover:bg-sunken hover:text-ink"
              >
                <ChatIcon size={20} />
                {unread ? (
                  <span className="absolute top-1.5 right-1.5 flex size-4.5 items-center justify-center rounded-full bg-hot text-[9px] font-extrabold text-white">
                    {unread > 9 ? "9+" : unread}
                  </span>
                ) : null}
              </Link>
            ) : null}
            {access.signedIn ? (
              <Link
                to="/account"
                aria-label="Account"
                className="hidden size-11 items-center justify-center rounded-xl text-muted no-underline hover:bg-sunken hover:text-ink lg:flex"
              >
                <UserIcon size={20} />
              </Link>
            ) : null}
            <span className="hidden lg:block">
              <ThemeToggle />
            </span>
            {access.ready && !access.signedIn ? (
              <Link
                to={`/login?next=${encodeURIComponent(pathname + search)}`}
                className={buttonClass("primary")}
              >
                <span className="text-on-brand">Sign in</span>
              </Link>
            ) : (
              <WalletChip cash={cash} credit={credit} className="hidden min-h-11 sm:flex" />
            )}
            <NavMenu
              title="Menu"
              className="lg:hidden"
              links={menuLinks}
              top={
                access.signedIn ? (
                  <WalletChip cash={cash} credit={credit} className="flex min-h-14" showArrow />
                ) : null
              }
              account={access.email}
              signingOut={signOut.isPending}
              onSignOut={
                access.signedIn
                  ? (done) =>
                      signOut.mutate(undefined, {
                        onSuccess: () => {
                          done();
                          navigate("/");
                        },
                      })
                  : undefined
              }
              bottom={
                <div className="flex flex-col gap-1 border-t border-line pt-3 text-xs text-subtle">
                  <Link to="/credits" className="flex min-h-11 w-fit items-center">
                    Photo credits
                  </Link>
                  <span>
                    Licensed by LSLGA · Licence [NUMBER] · Lagos residents 18+
                    only · Play responsibly
                  </span>
                </div>
              }
            />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-5 pb-32 sm:px-6 lg:pb-16">
        <div key={pathname} className="animate-fade-in">
          <Outlet />
        </div>
      </main>

      <footer className="hidden border-t border-line bg-surface/50 lg:block">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-6 text-xs text-subtle">
          <div className="flex items-center gap-2">
            <ShieldIcon size={16} className="text-brand" />
            <span>
              Licensed by LSLGA · Licence [NUMBER] · Lagos residents 18+ only ·
              Play responsibly
            </span>
          </div>
          <div className="flex gap-4">
            <Link to="/credits">Photo credits</Link>
            {access.signedIn ? null : (
              <Link to="/login">Store or DrawMart team? Sign in</Link>
            )}
          </div>
        </div>
      </footer>

      <nav
        className="fixed inset-x-3 bottom-[max(env(safe-area-inset-bottom),12px)] z-30 grid grid-cols-4 gap-1 rounded-3xl border border-line bg-raised/90 p-1.5 shadow-lift backdrop-blur-xl lg:hidden"
        aria-label="Main"
      >
        {BOTTOM_NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              cx(
                "relative flex min-h-13 flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] no-underline transition",
                isActive
                  ? "bg-brand-soft font-extrabold text-brand-ink"
                  : "font-semibold text-subtle",
              )
            }
          >
            <n.icon size={22} />
            {n.label}
            {n.to === "/tickets" && active > 0 ? (
              <span className="absolute top-1 right-[calc(50%-20px)] flex size-4.5 items-center justify-center rounded-full bg-hot text-[9px] font-extrabold text-white">
                {active}
              </span>
            ) : null}
            {n.to === "/messages" && unread > 0 ? (
              <span className="absolute top-1 right-[calc(50%-20px)] flex size-4.5 items-center justify-center rounded-full bg-hot text-[9px] font-extrabold text-white">
                {unread > 9 ? "9+" : unread}
              </span>
            ) : null}
          </NavLink>
        ))}
      </nav>
      <IntroSheet />
      <WinCelebration />
      <ScrollRestoration />
    </div>
  );
}
