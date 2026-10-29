import { useState, type FormEvent } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import { api } from "@/api";
import { usePasswordSignIn, useSendSignInLink, useSession } from "@/api/hooks";
import type { AccountRole } from "@/api/types";
import {
  MailIcon,
  ShieldIcon,
  StoreIcon,
  TicketIcon,
  type IconComponent,
} from "@/components/icons";
import {
  Button,
  Card,
  Field,
  Notice,
  Segmented,
  Skeleton,
  errorMessage,
  inputCls,
} from "@/components/ui";
import { landingFor } from "@/lib/apps";

type Method = "link" | "password";

const ROLE_BUTTON: Record<AccountRole, { label: string; icon: IconComponent }> =
  {
    buyer: { label: "Buyer", icon: TicketIcon },
    store: { label: "Store", icon: StoreIcon },
    admin: { label: "Admin", icon: ShieldIcon },
  };

const ROLE_GROUP: Record<AccountRole, string> = {
  buyer: "Buyers (buyer app)",
  store: "Stores (store app)",
  admin: "Admin (admin app)",
};

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/**
 * /login, the only way into any app. Buyers, stores and admins share this
 * form; once signed in, each account goes to its own app.
 */
export function SignInPage() {
  const [params] = useSearchParams();
  const next = params.get("next");
  const session = useSession();
  const sendLink = useSendSignInLink();
  const passwordSignIn = usePasswordSignIn();
  const { emailLinks, demoAccounts } = api.auth;
  const [method, setMethod] = useState<Method>(
    emailLinks ? "link" : "password",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);

  if (session.data)
    return <Navigate to={landingFor(session.data.role, next)} replace />;
  if (session.isPending) return <Skeleton className="mx-auto h-96 max-w-md" />;

  const busy = sendLink.isPending || passwordSignIn.isPending;
  const error = method === "link" ? sendLink.error : passwordSignIn.error;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const address = email.trim();
    setInvalid(!isEmail(address));
    if (!isEmail(address)) return;
    if (method === "link") {
      // The link brings them back here, and the redirect above sends them to their app.
      const back = next ? `?next=${encodeURIComponent(next)}` : "";
      const redirectTo = `${window.location.origin}/login${back}`;
      sendLink.mutate(
        { email: address, redirectTo },
        { onSuccess: () => setSentTo(address) },
      );
    } else {
      passwordSignIn.mutate({ email: address, password });
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md animate-fade-up flex-col gap-5 py-4">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex size-14 -rotate-6 items-center justify-center rounded-2xl bg-linear-to-br from-brand to-hero text-ticket shadow-glow">
          <TicketIcon size={28} strokeWidth={2.4} />
        </span>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">
          Sign in to DrawMart
        </h1>
        <p className="text-sm text-muted">
          One sign-in for buyers, stores and the DrawMart team. We’ll open the
          right app for your account.
          {method === "link"
            ? " No password needed: we’ll email you a link, and set up a buyer account the first time."
            : ""}
        </p>
      </div>

      <Card className="flex flex-col gap-5 p-5 sm:p-6">
        {sentTo ? (
          <>
            <Notice tone="brand" icon={MailIcon} title="Check your email">
              We sent a sign-in link to <strong>{sentTo}</strong>. Open it on
              this device to continue.
            </Notice>
            <Button variant="outline" onClick={() => setSentTo(null)}>
              Use a different email
            </Button>
          </>
        ) : (
          <>
            {emailLinks ? (
              <Segmented<Method>
                label="How to sign in"
                value={method}
                onChange={setMethod}
                className="w-full"
                options={[
                  { value: "link", label: "Email me a link" },
                  { value: "password", label: "Use a password" },
                ]}
              />
            ) : null}
            <form
              onSubmit={onSubmit}
              noValidate
              className="flex flex-col gap-4"
            >
              <Field
                label="Email address"
                htmlFor="email"
                error={invalid ? "Enter a valid email address." : undefined}
              >
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className={inputCls}
                />
              </Field>
              {method === "password" ? (
                <Field label="Password" htmlFor="password">
                  <input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={inputCls}
                  />
                </Field>
              ) : null}
              {error ? <Notice tone="hot">{errorMessage(error)}</Notice> : null}
              <Button
                type="submit"
                size="lg"
                loading={busy}
                disabled={method === "password" && !password}
              >
                {method === "link" ? "Email me a sign-in link" : "Sign in"}
              </Button>
            </form>
          </>
        )}
      </Card>

      {demoAccounts.length ? (
        <Card className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-extrabold tracking-wider text-subtle uppercase">
              Test accounts
            </span>
            <span className="text-xs text-subtle">
              Tap one to sign in. Password for all: {demoAccounts[0].password}.{" "}
              {emailLinks
                ? "Test mode only."
                : "Data stays in this browser."}
            </span>
          </div>
          {(["buyer", "store", "admin"] as const).map((role) => {
            const accounts = demoAccounts.filter((a) => a.role === role);
            if (!accounts.length) return null;
            const b = ROLE_BUTTON[role];
            return (
              <div key={role} className="flex flex-col gap-2">
                <span className="flex items-center gap-1.5 text-xs font-bold text-muted">
                  <b.icon size={14} /> {ROLE_GROUP[role]}
                </span>
                <div className="grid gap-2 sm:grid-cols-2">
                  {accounts.map((a) => (
                    <button
                      key={a.email}
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setMethod("password");
                        setEmail(a.email);
                        setPassword(a.password);
                        passwordSignIn.mutate({
                          email: a.email,
                          password: a.password,
                        });
                      }}
                      className="flex min-h-11 flex-col items-start justify-center rounded-xl border border-line-strong px-3 py-2 text-left transition hover:border-ink/40 disabled:opacity-60"
                    >
                      <span className="text-sm font-bold">{a.name}</span>
                      <span className="text-[11px] text-subtle">
                        {a.note ? `${a.note} · ` : ""}
                        {a.email}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </Card>
      ) : null}

      <div className="flex flex-col items-center gap-2 text-center text-xs text-subtle">
        <span>
          Selling on DrawMart? Store accounts are set up by our team once your
          CAC registration is verified.
        </span>
        <Link to="/" className="flex min-h-11 items-center font-bold">
          Just browsing? See live draws
        </Link>
        <span className="flex items-start gap-2">
          <ShieldIcon size={16} className="mt-px shrink-0 text-brand" />
          DrawMart is for adults 18+ living in licensed states. Play
          responsibly.
        </span>
      </div>
    </div>
  );
}
