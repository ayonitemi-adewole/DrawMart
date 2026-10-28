import { useState, type FormEvent } from "react";
import { Navigate, useSearchParams } from "react-router";
import { api } from "@/api";
import { usePasswordSignIn, useSendSignInLink, useSession } from "@/api/hooks";
import { MailIcon, ShieldIcon, TicketIcon } from "@/components/icons";
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

type Method = "link" | "password";

/** Created by supabase/seed-local-accounts.sql on `supabase db reset`. */
const DEMO_ACCOUNTS = [
  { email: "buyer@drawmart.test", label: "Buyer" },
  { email: "store@drawmart.test", label: "Store" },
  { email: "admin@drawmart.test", label: "Admin" },
];
const DEMO_PASSWORD = "drawmart-demo";

/** Only lets `next` point inside the app. */
function safeNext(next: string | null) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/** /login. Signed-in visitors (and everyone on the mock, which has no accounts) go straight on. */
export function SignInPage() {
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const session = useSession();
  const sendLink = useSendSignInLink();
  const passwordSignIn = usePasswordSignIn();
  const [method, setMethod] = useState<Method>("link");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);

  if (!api.auth || session.data) return <Navigate to={next} replace />;
  if (session.isPending) return <Skeleton className="mx-auto h-96 max-w-md" />;

  const busy = sendLink.isPending || passwordSignIn.isPending;
  const error = method === "link" ? sendLink.error : passwordSignIn.error;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const address = email.trim();
    setInvalid(!isEmail(address));
    if (!isEmail(address)) return;
    if (method === "link") {
      // The link brings them back here, and the redirect above sends them on to `next`.
      const redirectTo = `${window.location.origin}/login?next=${encodeURIComponent(next)}`;
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
          Sign in to shop
        </h1>
        <p className="text-sm text-muted">
          {method === "link"
            ? "No password needed. We’ll email you a link that signs you in, and sets up your account the first time."
            : "Sign in with your email and password."}
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

      {import.meta.env.DEV && api.testMode ? (
        <Card className="flex flex-col gap-3 p-4">
          <span className="text-xs font-extrabold tracking-wider text-subtle uppercase">
            Local demo accounts
          </span>
          <div className="grid grid-cols-3 gap-2">
            {DEMO_ACCOUNTS.map((a) => (
              <Button
                key={a.email}
                variant="outline"
                size="sm"
                className="min-h-11"
                onClick={() => {
                  setMethod("password");
                  setEmail(a.email);
                  setPassword(DEMO_PASSWORD);
                  setSentTo(null);
                }}
              >
                {a.label}
              </Button>
            ))}
          </div>
          <span className="text-xs text-subtle">
            Only exist on a local database (`npm run db:reset`). Password:{" "}
            {DEMO_PASSWORD}
          </span>
        </Card>
      ) : null}

      <p className="flex items-start justify-center gap-2 text-xs text-subtle">
        <ShieldIcon size={16} className="mt-px shrink-0 text-brand" />
        DrawMart is for adults 18+ living in licensed states. Play responsibly.
      </p>
    </div>
  );
}
