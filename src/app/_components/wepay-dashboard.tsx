"use client";

import { signIn, signOut, useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { api } from "~/trpc/react";

function formatMoney(value: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function niceLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getAuthErrorMessage(error?: string | null) {
  switch (error) {
    case "CredentialsSignin":
      return "That email and password combination did not match our records.";
    case "AccessDenied":
      return "Access was denied. Please try again.";
    case "SessionRequired":
      return "Please sign in to continue.";
    case "CallbackRouteError":
      return "We could not finish signing you in. Please try once more.";
    default:
      return "We could not sign you in right now. Please try again.";
  }
}

type Feedback = {
  type: "success" | "error";
  message: string;
} | null;

const groupTypes = [
  "HOME",
  "TRIP",
  "FRIENDS",
  "OFFICE",
  "FAMILY",
  "CLUB",
  "OTHER",
] as const;

const expenseCategories = [
  "GROCERIES",
  "RENT",
  "ELECTRICITY",
  "INTERNET",
  "CLEANING",
  "TRANSPORT",
  "DINING",
  "TRIP",
  "MAINTENANCE",
  "OTHER",
] as const;

type GroupType = (typeof groupTypes)[number];
type ExpenseCategory = (typeof expenseCategories)[number];

function FeedbackBanner({
  feedback,
  className = "",
}: {
  feedback: Feedback;
  className?: string;
}) {
  if (!feedback) return null;

  return (
    <div
      className={`rounded-2xl border px-4 py-3 text-sm ${
        feedback.type === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-rose-200 bg-rose-50 text-rose-700"
      } ${className}`}
    >
      {feedback.message}
    </div>
  );
}

export function WepayDashboard() {
  const searchParams = useSearchParams();
  const { data: session, status, update } = useSession();
  const isAuthed = status === "authenticated";

  const utils = api.useUtils();

  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authFeedback, setAuthFeedback] = useState<Feedback>(null);
  const [workspaceFeedback, setWorkspaceFeedback] = useState<Feedback>(null);
  const [loginPending, setLoginPending] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showSignupPassword, setShowSignupPassword] = useState(false);

  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [signupForm, setSignupForm] = useState({
    name: "",
    email: "",
    password: "",
  });

  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [createGroupForm, setCreateGroupForm] = useState({
    name: "",
    description: "",
    type: "OTHER" as GroupType,
    currency: "USD",
  });
  const [joinCode, setJoinCode] = useState("");
  const [expenseForm, setExpenseForm] = useState({
    title: "",
    amount: "",
    category: "OTHER" as ExpenseCategory,
    notes: "",
    paymentSource: "PERSONAL" as "PERSONAL" | "WALLET",
  });
  const [participants, setParticipants] = useState<string[]>([]);
  const [fundAmount, setFundAmount] = useState("");
  const [fundNote, setFundNote] = useState("");
  const [settleForm, setSettleForm] = useState({
    payerMemberId: "",
    receiverMemberId: "",
    amount: "",
    note: "",
  });

  const groupsQuery = api.group.list.useQuery(undefined, {
    enabled: isAuthed,
  });

  const groupDetails = api.group.details.useQuery(
    { groupId: activeGroupId ?? "" },
    { enabled: isAuthed && Boolean(activeGroupId) },
  );

  const dashboard = api.finance.dashboard.useQuery(
    { groupId: activeGroupId ?? "" },
    { enabled: isAuthed && Boolean(activeGroupId) },
  );

  const myMember = api.group.myMemberId.useQuery(
    { groupId: activeGroupId ?? "" },
    { enabled: isAuthed && Boolean(activeGroupId) },
  );

  const registerMutation = api.auth.register.useMutation();

  const createGroup = api.group.create.useMutation({
    onMutate: () => setWorkspaceFeedback(null),
    onSuccess: async (result) => {
      await utils.group.list.invalidate();
      setCreateGroupForm({
        name: "",
        description: "",
        type: "OTHER",
        currency: "USD",
      });
      setActiveGroupId(result.groupId);
      setWorkspaceFeedback({
        type: "success",
        message:
          "Private group created. Share the join code to bring people in.",
      });
    },
    onError: (err) =>
      setWorkspaceFeedback({ type: "error", message: err.message }),
  });

  const joinByCode = api.group.joinByCode.useMutation({
    onMutate: () => setWorkspaceFeedback(null),
    onSuccess: async (result) => {
      await utils.group.list.invalidate();
      setJoinCode("");
      setActiveGroupId(result.groupId);
      setWorkspaceFeedback({
        type: "success",
        message: result.alreadyMember
          ? "You were already in this group, so we reopened it for you."
          : "Joined successfully. Your dashboard is ready.",
      });
    },
    onError: (err) =>
      setWorkspaceFeedback({ type: "error", message: err.message }),
  });

  const addExpense = api.finance.addExpense.useMutation({
    onMutate: () => setWorkspaceFeedback(null),
    onSuccess: async () => {
      await Promise.all([
        utils.finance.dashboard.invalidate(),
        utils.group.details.invalidate(),
        utils.group.list.invalidate(),
      ]);
      setExpenseForm({
        title: "",
        amount: "",
        category: "OTHER",
        notes: "",
        paymentSource: "PERSONAL",
      });
      setParticipants(members.map((member) => member.id));
      setWorkspaceFeedback({
        type: "success",
        message: "Expense saved and balances refreshed.",
      });
    },
    onError: (err) =>
      setWorkspaceFeedback({ type: "error", message: err.message }),
  });

  const addFund = api.finance.addWalletContribution.useMutation({
    onMutate: () => setWorkspaceFeedback(null),
    onSuccess: async () => {
      await Promise.all([
        utils.finance.dashboard.invalidate(),
        utils.group.list.invalidate(),
      ]);
      setFundAmount("");
      setFundNote("");
      setWorkspaceFeedback({
        type: "success",
        message: "Wallet updated successfully.",
      });
    },
    onError: (err) =>
      setWorkspaceFeedback({ type: "error", message: err.message }),
  });

  const addSettlement = api.finance.addSettlement.useMutation({
    onMutate: () => setWorkspaceFeedback(null),
    onSuccess: async () => {
      await Promise.all([
        utils.finance.dashboard.invalidate(),
        utils.group.details.invalidate(),
      ]);
      setSettleForm((prev) => ({
        ...prev,
        amount: "",
        note: "",
      }));
      setWorkspaceFeedback({
        type: "success",
        message: "Settlement recorded.",
      });
    },
    onError: (err) =>
      setWorkspaceFeedback({ type: "error", message: err.message }),
  });

  const members = useMemo(
    () => groupDetails.data?.group.members ?? [],
    [groupDetails.data?.group.members],
  );

  const memberMap = useMemo(
    () => new Map(members.map((member) => [member.id, member.name])),
    [members],
  );

  const activeGroup = groupsQuery.data?.find(
    (group) => group.id === activeGroupId,
  );
  const activeDashboardError = groupDetails.error ?? dashboard.error;
  const authBusy = loginPending || registerMutation.isPending;
  const isWorkspaceBusy =
    createGroup.isPending ||
    joinByCode.isPending ||
    addExpense.isPending ||
    addFund.isPending ||
    addSettlement.isPending;

  useEffect(() => {
    const error = searchParams.get("error");
    if (error) {
      setAuthFeedback({
        type: "error",
        message: getAuthErrorMessage(error),
      });
    }
  }, [searchParams]);

  useEffect(() => {
    if (!activeGroupId && groupsQuery.data && groupsQuery.data.length > 0) {
      setActiveGroupId(groupsQuery.data[0]!.id);
    }
  }, [activeGroupId, groupsQuery.data]);

  useEffect(() => {
    if (!members.length) return;

    setParticipants((prev) => (prev.length ? prev : members.map((m) => m.id)));
    setSettleForm((prev) => ({
      ...prev,
      payerMemberId: prev.payerMemberId || members[0]!.id,
      receiverMemberId:
        prev.receiverMemberId || (members[1]?.id ?? members[0]!.id),
    }));
  }, [members]);

  useEffect(() => {
    if (status === "authenticated") {
      setAuthFeedback(null);
    }
  }, [status]);

  useEffect(() => {
    setWorkspaceFeedback(null);
  }, [activeGroupId]);

  async function completeLogin(email: string, password: string) {
    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
      redirectTo: "/",
    });

    if (result?.error || !result?.ok) {
      setAuthFeedback({
        type: "error",
        message: getAuthErrorMessage(result?.error),
      });
      return false;
    }

    await update();
    setAuthFeedback({
      type: "success",
      message: "Signed in. Opening your workspace...",
    });

    window.location.assign(result.url ?? "/");
    return true;
  }

  async function handleLoginSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = loginForm.email.trim().toLowerCase();

    if (!email || !loginForm.password) {
      setAuthFeedback({
        type: "error",
        message: "Enter both your email and password.",
      });
      return;
    }

    setLoginPending(true);
    setAuthFeedback(null);

    try {
      await completeLogin(email, loginForm.password);
    } catch {
      setAuthFeedback({
        type: "error",
        message: "We could not sign you in right now. Please try again.",
      });
    } finally {
      setLoginPending(false);
    }
  }

  async function handleSignupSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const payload = {
      name: signupForm.name.trim(),
      email: signupForm.email.trim().toLowerCase(),
      password: signupForm.password,
    };

    if (!payload.name || !payload.email || !payload.password) {
      setAuthFeedback({
        type: "error",
        message:
          "Complete your name, email, and password to create an account.",
      });
      return;
    }

    setAuthFeedback(null);

    try {
      await registerMutation.mutateAsync(payload);
      setLoginForm({ email: payload.email, password: "" });
      const loggedIn = await completeLogin(payload.email, payload.password);

      if (!loggedIn) {
        setAuthMode("login");
        setAuthFeedback({
          type: "error",
          message:
            "Your account was created, but we could not sign you in automatically. Please log in once with your new password.",
        });
      }
    } catch (error) {
      setAuthFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "We could not create your account. Please try again.",
      });
    }
  }

  function setAllParticipants(selected: boolean) {
    setParticipants(selected ? members.map((member) => member.id) : []);
  }

  if (status === "loading") {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#f9d8a8_0%,transparent_28%),radial-gradient(circle_at_top_right,#9edbd0_0%,transparent_24%),linear-gradient(135deg,#fff8ee_0%,#f6efe2_50%,#efe7d8_100%)] px-4 py-8 text-slate-900 md:px-8">
        <div className="mx-auto flex min-h-[70vh] max-w-3xl items-center justify-center rounded-[32px] border border-slate-900/10 bg-white/80 p-10 text-center shadow-[0_30px_90px_-48px_rgba(15,23,42,0.5)] backdrop-blur">
          <div>
            <p className="text-xs font-semibold tracking-[0.28em] text-slate-500 uppercase">
              Preparing workspace
            </p>
            <h1 className="font-heading mt-3 text-4xl">Wepay</h1>
            <p className="mt-2 text-sm text-slate-600">
              Checking your session and loading your latest data.
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (!session?.user) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#f4c88b_0%,transparent_28%),radial-gradient(circle_at_85%_8%,#8ed8c8_0%,transparent_22%),radial-gradient(circle_at_bottom_right,#f4a9a2_0%,transparent_20%),linear-gradient(135deg,#fff7eb_0%,#f7efdf_48%,#efe5d2_100%)] px-4 py-6 text-slate-900 md:px-8 lg:py-10">
        <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[1.12fr_0.88fr]">
          <section className="relative overflow-hidden rounded-[32px] border border-slate-900/10 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(255,247,235,0.94)_100%)] p-6 shadow-[0_30px_90px_-48px_rgba(15,23,42,0.45)] sm:p-8 lg:p-10">
            <div className="absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_top,#ffffff_0%,transparent_72%)] opacity-70" />
            <div className="relative">
              <p className="inline-flex rounded-full border border-slate-900/10 bg-white/75 px-3 py-1 text-xs font-semibold tracking-[0.24em] text-slate-600 uppercase">
                Shared money, calmer groups
              </p>
              <h1 className="font-heading mt-6 max-w-2xl text-5xl leading-[0.95] sm:text-6xl">
                Wepay keeps every trip, home, and group expense easy to follow.
              </h1>
              <p className="mt-5 max-w-xl text-base leading-7 text-slate-700">
                Track who paid, top up a shared wallet, and settle faster with a
                private space built for real groups instead of messy chats and
                spreadsheets.
              </p>

              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                <article className="rounded-3xl border border-amber-200/70 bg-amber-50/90 p-4">
                  <p className="text-xs font-semibold tracking-[0.2em] text-amber-900/70 uppercase">
                    Private Groups
                  </p>
                  <p className="mt-2 text-2xl font-semibold">Invite-only</p>
                  <p className="mt-1 text-sm text-slate-700">
                    Each group gets its own join code and private ledger.
                  </p>
                </article>
                <article className="rounded-3xl border border-teal-200/80 bg-teal-50/90 p-4">
                  <p className="text-xs font-semibold tracking-[0.2em] text-teal-900/70 uppercase">
                    Shared Wallet
                  </p>
                  <p className="mt-2 text-2xl font-semibold">One balance</p>
                  <p className="mt-1 text-sm text-slate-700">
                    Separate wallet-paid expenses from personal ones instantly.
                  </p>
                </article>
                <article className="rounded-3xl border border-rose-200/80 bg-rose-50/90 p-4">
                  <p className="text-xs font-semibold tracking-[0.2em] text-rose-900/70 uppercase">
                    Settle Faster
                  </p>
                  <p className="mt-2 text-2xl font-semibold">Clear balances</p>
                  <p className="mt-1 text-sm text-slate-700">
                    Suggested settlements help groups wrap up cleanly.
                  </p>
                </article>
              </div>

              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                <div className="rounded-[28px] border border-slate-900/10 bg-white/80 p-5">
                  <p className="text-xs font-semibold tracking-[0.2em] text-slate-500 uppercase">
                    Why teams keep this open
                  </p>
                  <ul className="mt-4 space-y-3 text-sm text-slate-700">
                    <li>
                      Everyone sees the latest wallet, expenses, and
                      settlements.
                    </li>
                    <li>
                      No more guessing whether something was paid personally or
                      from the pool.
                    </li>
                    <li>
                      Activity history makes every change easy to trace later.
                    </li>
                  </ul>
                </div>
                <div className="rounded-[28px] border border-slate-900/10 bg-slate-900 p-5 text-white">
                  <p className="text-xs font-semibold tracking-[0.2em] text-white/60 uppercase">
                    Best for
                  </p>
                  <ul className="mt-4 space-y-3 text-sm text-white/85">
                    <li>Roommates splitting rent, groceries, and utilities</li>
                    <li>Trips where several people pay across the week</li>
                    <li>Friends or clubs running a shared event budget</li>
                  </ul>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-[32px] border border-slate-900/10 bg-white/88 p-6 shadow-[0_30px_90px_-48px_rgba(15,23,42,0.45)] backdrop-blur sm:p-8">
            <p className="text-xs font-semibold tracking-[0.28em] text-slate-500 uppercase">
              Welcome
            </p>
            <h2 className="font-heading mt-3 text-4xl">
              {authMode === "login"
                ? "Sign in to your workspace"
                : "Create your Wepay account"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {authMode === "login"
                ? "Use the email and password you used when you created your account."
                : "You will be signed in right after your account is created."}
            </p>

            <div className="mt-6 flex rounded-full bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => {
                  setAuthMode("login");
                  setAuthFeedback(null);
                }}
                className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold transition ${
                  authMode === "login"
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Login
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthMode("signup");
                  setAuthFeedback(null);
                }}
                className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold transition ${
                  authMode === "signup"
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Sign Up
              </button>
            </div>

            <FeedbackBanner feedback={authFeedback} className="mt-5" />

            {authMode === "login" ? (
              <form className="mt-5 space-y-4" onSubmit={handleLoginSubmit}>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-700">
                    Email
                  </span>
                  <input
                    type="email"
                    value={loginForm.email}
                    onChange={(event) => {
                      setAuthFeedback(null);
                      setLoginForm((prev) => ({
                        ...prev,
                        email: event.target.value,
                      }));
                    }}
                    autoComplete="email"
                    placeholder="you@example.com"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm transition outline-none focus:border-slate-400 focus:bg-white"
                    required
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-700">
                    Password
                  </span>
                  <div className="relative">
                    <input
                      type={showLoginPassword ? "text" : "password"}
                      value={loginForm.password}
                      onChange={(event) => {
                        setAuthFeedback(null);
                        setLoginForm((prev) => ({
                          ...prev,
                          password: event.target.value,
                        }));
                      }}
                      autoComplete="current-password"
                      placeholder="Enter your password"
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 pr-20 text-sm transition outline-none focus:border-slate-400 focus:bg-white"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowLoginPassword((prev) => !prev)}
                      className="absolute inset-y-0 right-3 my-auto h-fit text-xs font-semibold text-slate-500 hover:text-slate-900"
                    >
                      {showLoginPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </label>

                <button
                  type="submit"
                  disabled={authBusy}
                  className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                >
                  {loginPending ? "Signing in..." : "Sign in"}
                </button>
              </form>
            ) : (
              <form className="mt-5 space-y-4" onSubmit={handleSignupSubmit}>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-700">
                    Full name
                  </span>
                  <input
                    value={signupForm.name}
                    onChange={(event) => {
                      setAuthFeedback(null);
                      setSignupForm((prev) => ({
                        ...prev,
                        name: event.target.value,
                      }));
                    }}
                    autoComplete="name"
                    placeholder="Your name"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm transition outline-none focus:border-slate-400 focus:bg-white"
                    required
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-700">
                    Email
                  </span>
                  <input
                    type="email"
                    value={signupForm.email}
                    onChange={(event) => {
                      setAuthFeedback(null);
                      setSignupForm((prev) => ({
                        ...prev,
                        email: event.target.value,
                      }));
                    }}
                    autoComplete="email"
                    placeholder="you@example.com"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm transition outline-none focus:border-slate-400 focus:bg-white"
                    required
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-700">
                    Password
                  </span>
                  <div className="relative">
                    <input
                      type={showSignupPassword ? "text" : "password"}
                      value={signupForm.password}
                      onChange={(event) => {
                        setAuthFeedback(null);
                        setSignupForm((prev) => ({
                          ...prev,
                          password: event.target.value,
                        }));
                      }}
                      autoComplete="new-password"
                      placeholder="At least 8 characters"
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 pr-20 text-sm transition outline-none focus:border-slate-400 focus:bg-white"
                      minLength={8}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowSignupPassword((prev) => !prev)}
                      className="absolute inset-y-0 right-3 my-auto h-fit text-xs font-semibold text-slate-500 hover:text-slate-900"
                    >
                      {showSignupPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </label>

                <p className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  Your email is used only for sign-in and member identity inside
                  your private groups.
                </p>

                <button
                  type="submit"
                  disabled={authBusy}
                  className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                >
                  {registerMutation.isPending
                    ? "Creating account..."
                    : "Create account"}
                </button>
              </form>
            )}
          </section>
        </div>
      </main>
    );
  }

  const currency = groupDetails.data?.group.currency ?? "USD";

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#f4d19a_0%,transparent_24%),radial-gradient(circle_at_top_right,#9edbd0_0%,transparent_20%),linear-gradient(135deg,#fff7eb_0%,#f5eddc_45%,#ece2d0_100%)] px-4 py-6 text-slate-900 md:px-8">
      <div className="mx-auto grid w-full max-w-7xl gap-4 lg:grid-cols-[350px_1fr]">
        <section className="rounded-[30px] border border-slate-900/10 bg-white/85 p-5 shadow-[0_28px_90px_-50px_rgba(15,23,42,0.45)] backdrop-blur">
          <div className="rounded-[26px] bg-slate-900 p-5 text-white">
            <p className="text-xs font-semibold tracking-[0.24em] text-white/60 uppercase">
              Signed in
            </p>
            <h1 className="font-heading mt-3 text-4xl">Shared Wallet</h1>
            <p className="mt-2 text-sm text-white/80">
              {session.user.name ?? session.user.email}
            </p>
            <button
              onClick={() => signOut({ redirectTo: "/" })}
              className="mt-4 rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/15"
            >
              Sign out
            </button>
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold tracking-[0.22em] text-slate-500 uppercase">
                  Your groups
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  Switch between spaces or start a new one.
                </p>
              </div>
              {groupsQuery.isFetching && (
                <span className="text-xs font-semibold text-slate-500">
                  Refreshing...
                </span>
              )}
            </div>

            <FeedbackBanner feedback={workspaceFeedback} className="mt-4" />

            <div className="mt-4 space-y-2">
              {groupsQuery.isLoading && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                  Loading your groups...
                </div>
              )}

              {groupsQuery.error && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
                  {groupsQuery.error.message}
                </div>
              )}

              {groupsQuery.data?.map((group) => (
                <button
                  key={group.id}
                  onClick={() => setActiveGroupId(group.id)}
                  className={`w-full rounded-[24px] border px-4 py-4 text-left transition ${
                    activeGroupId === group.id
                      ? "border-slate-900 bg-slate-900 text-white shadow-lg"
                      : "border-slate-200 bg-white hover:border-slate-400 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold">{group.name}</p>
                    <span className="rounded-full bg-black/5 px-2.5 py-1 text-[11px] font-semibold tracking-[0.14em] text-current uppercase">
                      {niceLabel(group.type)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm opacity-80">
                    {group.description ?? "No description yet"}
                  </p>
                  <div className="mt-3 flex items-center justify-between text-xs opacity-80">
                    <span>{group.memberCount} members</span>
                    <span>
                      Wallet {formatMoney(group.walletBalance, group.currency)}
                    </span>
                  </div>
                </button>
              ))}

              {!groupsQuery.isLoading &&
                !groupsQuery.data?.length &&
                !groupsQuery.error && (
                  <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600">
                    You are not in a group yet. Create one below or join with a
                    private code.
                  </div>
                )}
            </div>
          </div>

          <div className="mt-6 rounded-[28px] border border-slate-200 bg-slate-50/90 p-4">
            <div>
              <h2 className="text-sm font-semibold tracking-[0.2em] text-slate-500 uppercase">
                Create a group
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Set up a new private workspace for roommates, trips, or friends.
              </p>
            </div>

            <form
              className="mt-4 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                createGroup.mutate({
                  ...createGroupForm,
                  description: createGroupForm.description.trim() || undefined,
                });
              }}
            >
              <input
                placeholder="Group name"
                value={createGroupForm.name}
                onChange={(event) =>
                  setCreateGroupForm((prev) => ({
                    ...prev,
                    name: event.target.value,
                  }))
                }
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm transition outline-none focus:border-slate-400"
                required
              />
              <textarea
                placeholder="What is this group for?"
                value={createGroupForm.description}
                onChange={(event) =>
                  setCreateGroupForm((prev) => ({
                    ...prev,
                    description: event.target.value,
                  }))
                }
                className="h-24 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm transition outline-none focus:border-slate-400"
              />
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={createGroupForm.type}
                  onChange={(event) =>
                    setCreateGroupForm((prev) => ({
                      ...prev,
                      type: event.target.value as GroupType,
                    }))
                  }
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm transition outline-none focus:border-slate-400"
                >
                  {groupTypes.map((type) => (
                    <option key={type} value={type}>
                      {niceLabel(type)}
                    </option>
                  ))}
                </select>
                <input
                  maxLength={3}
                  value={createGroupForm.currency}
                  onChange={(event) =>
                    setCreateGroupForm((prev) => ({
                      ...prev,
                      currency: event.target.value.toUpperCase(),
                    }))
                  }
                  placeholder="USD"
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm uppercase transition outline-none focus:border-slate-400"
                />
              </div>
              <button
                type="submit"
                disabled={createGroup.isPending || isWorkspaceBusy}
                className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {createGroup.isPending ? "Creating..." : "Create private group"}
              </button>
            </form>
          </div>

          <div className="mt-4 rounded-[28px] border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-semibold tracking-[0.2em] text-slate-500 uppercase">
              Join with a code
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              Paste the 6-character invite code from your group owner.
            </p>
            <form
              className="mt-4 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                joinByCode.mutate({ code: joinCode.trim().toUpperCase() });
              }}
            >
              <input
                placeholder="ABC123"
                value={joinCode}
                onChange={(event) =>
                  setJoinCode(event.target.value.toUpperCase())
                }
                maxLength={6}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm uppercase transition outline-none focus:border-slate-400 focus:bg-white"
                required
              />
              <button
                type="submit"
                disabled={joinByCode.isPending || isWorkspaceBusy}
                className="w-full rounded-2xl bg-amber-400 px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-amber-200"
              >
                {joinByCode.isPending ? "Joining..." : "Join group"}
              </button>
            </form>
          </div>
        </section>

        <section className="rounded-[30px] border border-slate-900/10 bg-white/85 p-5 shadow-[0_28px_90px_-50px_rgba(15,23,42,0.45)] backdrop-blur">
          {!activeGroupId && (
            <div className="flex min-h-[60vh] items-center justify-center rounded-[28px] border border-dashed border-slate-300 bg-slate-50 px-6 text-center">
              <div>
                <p className="text-xs font-semibold tracking-[0.24em] text-slate-500 uppercase">
                  No group selected
                </p>
                <h2 className="font-heading mt-3 text-4xl">Pick a workspace</h2>
                <p className="mt-2 text-sm text-slate-600">
                  Choose a group from the left, create one, or join with a code
                  to start tracking shared money.
                </p>
              </div>
            </div>
          )}

          {activeGroupId && (groupDetails.isLoading || dashboard.isLoading) && (
            <div className="rounded-[28px] border border-slate-200 bg-slate-50 px-5 py-6 text-sm text-slate-600">
              Loading the latest balances, activity, and members...
            </div>
          )}

          {activeGroupId && activeDashboardError && (
            <div className="rounded-[28px] border border-rose-200 bg-rose-50 px-5 py-6 text-sm text-rose-700">
              {activeDashboardError.message}
            </div>
          )}

          {activeGroupId && groupDetails.data && dashboard.data && (
            <>
              <header className="flex flex-wrap items-start justify-between gap-4 rounded-[28px] bg-[linear-gradient(145deg,#fff8ee_0%,#ffffff_100%)] p-5">
                <div>
                  <p className="text-xs font-semibold tracking-[0.24em] text-slate-500 uppercase">
                    Group dashboard
                  </p>
                  <h2 className="font-heading mt-3 text-4xl leading-tight">
                    {groupDetails.data.group.name}
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                    {groupDetails.data.group.description ??
                      "No description yet. Use this space to manage shared spending and settlements."}
                  </p>
                </div>

                <div className="grid gap-2 text-sm text-slate-700">
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <span className="text-xs font-semibold tracking-[0.18em] text-slate-500 uppercase">
                      Invite code
                    </span>
                    <p className="mt-1 font-semibold">
                      {groupDetails.data.group.joinCode ?? "N/A"}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <span className="text-xs font-semibold tracking-[0.18em] text-slate-500 uppercase">
                      Group type
                    </span>
                    <p className="mt-1 font-semibold">
                      {niceLabel(groupDetails.data.group.type)}
                    </p>
                  </div>
                </div>
              </header>

              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <article className="rounded-[24px] border border-amber-200 bg-amber-50 p-4">
                  <p className="text-xs font-semibold tracking-[0.18em] text-amber-900/70 uppercase">
                    Wallet
                  </p>
                  <p className="mt-2 text-2xl font-semibold">
                    {formatMoney(
                      dashboard.data.balances.walletBalance,
                      currency,
                    )}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    Shared cash available now
                  </p>
                </article>
                <article className="rounded-[24px] border border-rose-200 bg-rose-50 p-4">
                  <p className="text-xs font-semibold tracking-[0.18em] text-rose-900/70 uppercase">
                    Unsettled
                  </p>
                  <p className="mt-2 text-2xl font-semibold">
                    {formatMoney(
                      dashboard.data.balances.unsettledAmount,
                      currency,
                    )}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    Amount still owed between members
                  </p>
                </article>
                <article className="rounded-[24px] border border-sky-200 bg-sky-50 p-4">
                  <p className="text-xs font-semibold tracking-[0.18em] text-sky-900/70 uppercase">
                    This week
                  </p>
                  <p className="mt-2 text-2xl font-semibold">
                    {formatMoney(
                      dashboard.data.weeklySummary.totalSpent,
                      currency,
                    )}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    Latest weekly spending
                  </p>
                </article>
                <article className="rounded-[24px] border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-xs font-semibold tracking-[0.18em] text-emerald-900/70 uppercase">
                    This month
                  </p>
                  <p className="mt-2 text-2xl font-semibold">
                    {formatMoney(
                      dashboard.data.monthlySummary.totalSpent,
                      currency,
                    )}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    Month-to-date group total
                  </p>
                </article>
              </div>

              <div className="mt-5 grid gap-3 xl:grid-cols-3">
                <form
                  className="rounded-[28px] border border-slate-200 bg-white p-5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!myMember.data) return;

                    const amount = Number(expenseForm.amount);
                    if (!Number.isFinite(amount) || amount <= 0) {
                      setWorkspaceFeedback({
                        type: "error",
                        message: "Enter a valid expense amount.",
                      });
                      return;
                    }

                    if (!participants.length) {
                      setWorkspaceFeedback({
                        type: "error",
                        message:
                          "Choose at least one participant for the expense.",
                      });
                      return;
                    }

                    addExpense.mutate({
                      groupId: activeGroupId,
                      title: expenseForm.title.trim(),
                      amount,
                      notes: expenseForm.notes.trim() || undefined,
                      category: expenseForm.category,
                      paymentSource: expenseForm.paymentSource,
                      splitType: "EQUAL",
                      paidByMemberId:
                        expenseForm.paymentSource === "PERSONAL"
                          ? myMember.data.memberId
                          : undefined,
                      participantIds: participants,
                      createdByMemberId: myMember.data.memberId,
                    });
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">Add expense</h3>
                      <p className="mt-1 text-sm text-slate-600">
                        Record a new purchase and split it equally across
                        selected members.
                      </p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                      {activeGroup?.memberCount ?? members.length} members
                    </span>
                  </div>

                  <div className="mt-4 grid gap-3">
                    <input
                      placeholder="Dinner, rent, groceries..."
                      value={expenseForm.title}
                      onChange={(event) =>
                        setExpenseForm((prev) => ({
                          ...prev,
                          title: event.target.value,
                        }))
                      }
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm transition outline-none focus:border-slate-400 focus:bg-white"
                      required
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        placeholder="Amount"
                        type="number"
                        min="0"
                        step="0.01"
                        value={expenseForm.amount}
                        onChange={(event) =>
                          setExpenseForm((prev) => ({
                            ...prev,
                            amount: event.target.value,
                          }))
                        }
                        className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm transition outline-none focus:border-slate-400 focus:bg-white"
                        required
                      />
                      <select
                        value={expenseForm.category}
                        onChange={(event) =>
                          setExpenseForm((prev) => ({
                            ...prev,
                            category: event.target.value as ExpenseCategory,
                          }))
                        }
                        className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm transition outline-none focus:border-slate-400 focus:bg-white"
                      >
                        {expenseCategories.map((category) => (
                          <option key={category} value={category}>
                            {niceLabel(category)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <select
                      value={expenseForm.paymentSource}
                      onChange={(event) =>
                        setExpenseForm((prev) => ({
                          ...prev,
                          paymentSource: event.target.value as
                            | "PERSONAL"
                            | "WALLET",
                        }))
                      }
                      className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm transition outline-none focus:border-slate-400 focus:bg-white"
                    >
                      <option value="PERSONAL">Paid personally</option>
                      <option value="WALLET">Paid from shared wallet</option>
                    </select>
                    <textarea
                      placeholder="Notes or context"
                      value={expenseForm.notes}
                      onChange={(event) =>
                        setExpenseForm((prev) => ({
                          ...prev,
                          notes: event.target.value,
                        }))
                      }
                      className="h-24 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm transition outline-none focus:border-slate-400 focus:bg-white"
                    />
                  </div>

                  <div className="mt-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold tracking-[0.2em] text-slate-500 uppercase">
                        Participants
                      </p>
                      <div className="flex gap-2 text-xs font-semibold">
                        <button
                          type="button"
                          onClick={() => setAllParticipants(true)}
                          className="rounded-full bg-slate-100 px-3 py-1 text-slate-600 hover:bg-slate-200"
                        >
                          Select all
                        </button>
                        <button
                          type="button"
                          onClick={() => setAllParticipants(false)}
                          className="rounded-full bg-slate-100 px-3 py-1 text-slate-600 hover:bg-slate-200"
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                    <div className="mt-2 max-h-40 space-y-2 overflow-y-auto">
                      {members.map((member) => (
                        <label
                          key={member.id}
                          className="flex items-center justify-between rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                        >
                          <span className="font-medium text-slate-700">
                            {member.name}
                          </span>
                          <input
                            type="checkbox"
                            checked={participants.includes(member.id)}
                            onChange={(event) => {
                              const checked = event.target.checked;
                              setParticipants((prev) =>
                                checked
                                  ? [...prev, member.id]
                                  : prev.filter((id) => id !== member.id),
                              );
                            }}
                          />
                        </label>
                      ))}
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={addExpense.isPending || !myMember.data}
                    className="mt-4 w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                  >
                    {addExpense.isPending ? "Saving expense..." : "Add expense"}
                  </button>
                </form>

                <form
                  className="rounded-[28px] border border-slate-200 bg-white p-5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!myMember.data) return;

                    const amount = Number(fundAmount);
                    if (!Number.isFinite(amount) || amount <= 0) {
                      setWorkspaceFeedback({
                        type: "error",
                        message: "Enter a valid wallet contribution amount.",
                      });
                      return;
                    }

                    addFund.mutate({
                      groupId: activeGroupId,
                      memberId: myMember.data.memberId,
                      amount,
                      note: fundNote.trim() || undefined,
                    });
                  }}
                >
                  <h3 className="font-semibold">Top up shared wallet</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    Add money to the group wallet so shared expenses can be paid
                    from the pool.
                  </p>

                  <div className="mt-4 space-y-3">
                    <input
                      placeholder="Amount"
                      type="number"
                      min="0"
                      step="0.01"
                      value={fundAmount}
                      onChange={(event) => setFundAmount(event.target.value)}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm transition outline-none focus:border-slate-400 focus:bg-white"
                      required
                    />
                    <input
                      placeholder="Note (optional)"
                      value={fundNote}
                      onChange={(event) => setFundNote(event.target.value)}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm transition outline-none focus:border-slate-400 focus:bg-white"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={addFund.isPending || !myMember.data}
                    className="mt-4 w-full rounded-2xl bg-amber-400 px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-amber-200"
                  >
                    {addFund.isPending ? "Updating wallet..." : "Add to wallet"}
                  </button>
                </form>

                <form
                  className="rounded-[28px] border border-slate-200 bg-white p-5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const amount = Number(settleForm.amount);

                    if (!Number.isFinite(amount) || amount <= 0) {
                      setWorkspaceFeedback({
                        type: "error",
                        message: "Enter a valid settlement amount.",
                      });
                      return;
                    }

                    if (
                      settleForm.payerMemberId === settleForm.receiverMemberId
                    ) {
                      setWorkspaceFeedback({
                        type: "error",
                        message:
                          "Choose two different members for a settlement.",
                      });
                      return;
                    }

                    addSettlement.mutate({
                      groupId: activeGroupId,
                      payerMemberId: settleForm.payerMemberId,
                      receiverMemberId: settleForm.receiverMemberId,
                      amount,
                      note: settleForm.note.trim() || undefined,
                    });
                  }}
                >
                  <h3 className="font-semibold">Record settlement</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    Log a payment when one member settles up with another.
                  </p>

                  <div className="mt-4 space-y-3">
                    <select
                      value={settleForm.payerMemberId}
                      onChange={(event) =>
                        setSettleForm((prev) => ({
                          ...prev,
                          payerMemberId: event.target.value,
                        }))
                      }
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm transition outline-none focus:border-slate-400 focus:bg-white"
                    >
                      {members.map((member) => (
                        <option key={member.id} value={member.id}>
                          Payer: {member.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={settleForm.receiverMemberId}
                      onChange={(event) =>
                        setSettleForm((prev) => ({
                          ...prev,
                          receiverMemberId: event.target.value,
                        }))
                      }
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm transition outline-none focus:border-slate-400 focus:bg-white"
                    >
                      {members.map((member) => (
                        <option key={member.id} value={member.id}>
                          Receiver: {member.name}
                        </option>
                      ))}
                    </select>
                    <input
                      placeholder="Amount"
                      type="number"
                      min="0"
                      step="0.01"
                      value={settleForm.amount}
                      onChange={(event) =>
                        setSettleForm((prev) => ({
                          ...prev,
                          amount: event.target.value,
                        }))
                      }
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm transition outline-none focus:border-slate-400 focus:bg-white"
                      required
                    />
                    <input
                      placeholder="Note (optional)"
                      value={settleForm.note}
                      onChange={(event) =>
                        setSettleForm((prev) => ({
                          ...prev,
                          note: event.target.value,
                        }))
                      }
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm transition outline-none focus:border-slate-400 focus:bg-white"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={addSettlement.isPending}
                    className="mt-4 w-full rounded-2xl bg-emerald-400 px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-emerald-200"
                  >
                    {addSettlement.isPending
                      ? "Recording..."
                      : "Record settlement"}
                  </button>
                </form>
              </div>

              <div className="mt-5 grid gap-3 xl:grid-cols-2">
                <section className="rounded-[28px] border border-slate-200 bg-white p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">Member balances</h3>
                      <p className="mt-1 text-sm text-slate-600">
                        Positive numbers mean the member should receive money.
                      </p>
                    </div>
                    <span className="text-xs font-semibold text-slate-500">
                      {members.length} people
                    </span>
                  </div>

                  <div className="mt-4 space-y-2 text-sm">
                    {dashboard.data.balances.memberBalances.map((member) => (
                      <div
                        key={member.memberId}
                        className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3"
                      >
                        <span className="font-medium text-slate-700">
                          {member.name}
                        </span>
                        <span className="font-semibold">
                          {formatMoney(member.netBalance, currency)}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-[28px] border border-slate-200 bg-white p-5">
                  <h3 className="font-semibold">Recent activity</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    The latest actions across this workspace.
                  </p>

                  <div className="mt-4 max-h-[24rem] space-y-2 overflow-y-auto text-sm">
                    {dashboard.data.recentActivity.length === 0 && (
                      <div className="rounded-2xl bg-slate-50 px-4 py-4 text-slate-600">
                        No activity yet. Add your first expense or wallet
                        top-up.
                      </div>
                    )}

                    {dashboard.data.recentActivity.map((entry) => (
                      <div
                        key={entry.id}
                        className="rounded-2xl border border-slate-100 px-4 py-3"
                      >
                        <p className="leading-6 text-slate-700">
                          <span className="font-semibold">
                            {entry.actorMember?.name ?? "System"}
                          </span>{" "}
                          {entry.note ?? niceLabel(entry.type)}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {formatDate(entry.createdAt)}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              <section className="mt-5 rounded-[28px] border border-slate-200 bg-white p-5">
                <h3 className="font-semibold">Suggested settlements</h3>
                <p className="mt-1 text-sm text-slate-600">
                  A quick path to closing outstanding balances.
                </p>

                <div className="mt-4 space-y-2 text-sm">
                  {dashboard.data.suggestions.length === 0 && (
                    <div className="rounded-2xl bg-slate-50 px-4 py-4 text-slate-600">
                      No pending suggestions right now. Your group is already
                      looking balanced.
                    </div>
                  )}

                  {dashboard.data.suggestions.map((suggestion, index) => (
                    <div
                      key={`${suggestion.fromMemberId}-${suggestion.toMemberId}-${index}`}
                      className="rounded-2xl border border-slate-100 px-4 py-3"
                    >
                      <span className="font-semibold">
                        {memberMap.get(suggestion.fromMemberId)}
                      </span>{" "}
                      pays{" "}
                      <span className="font-semibold">
                        {memberMap.get(suggestion.toMemberId)}
                      </span>{" "}
                      {formatMoney(suggestion.amount, currency)}
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
