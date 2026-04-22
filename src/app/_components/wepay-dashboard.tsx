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
type DashboardTab = "overview" | "records" | "history";
type PeriodRange = "week" | "month" | "custom";
type TransactionNature = "all" | "expense" | "settlement" | "wallet";
type ThemeMode = "dark" | "light";

function formatDateOnly(value: Date | string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
  }).format(new Date(value));
}

function formatRangeLabel(start: Date | string, end: Date | string) {
  const inclusiveEnd = new Date(end);
  inclusiveEnd.setDate(inclusiveEnd.getDate() - 1);
  return `${formatDateOnly(start)} - ${formatDateOnly(inclusiveEnd)}`;
}

function isMemberIncluded(
  memberId: string,
  values: Array<string | null | undefined>,
) {
  return values.some((value) => value === memberId);
}

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
  const [dashboardTab, setDashboardTab] = useState<DashboardTab>("overview");
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isMobileLayout, setIsMobileLayout] = useState(false);
  const [historyRange, setHistoryRange] = useState<PeriodRange>("month");
  const [historyNatureFilter, setHistoryNatureFilter] =
    useState<TransactionNature>("all");
  const [historyMemberFilter, setHistoryMemberFilter] = useState("all");
  const [historyStartDate, setHistoryStartDate] = useState(() => {
    const start = new Date();
    start.setDate(start.getDate() - 30);
    return start.toISOString().slice(0, 10);
  });
  const [historyEndDate, setHistoryEndDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [settleForm, setSettleForm] = useState({
    receiverMemberId: "",
    amount: "",
    note: "",
  });
  const hasValidCustomRange =
    historyRange !== "custom" ||
    (Boolean(historyStartDate) &&
      Boolean(historyEndDate) &&
      new Date(`${historyStartDate}T00:00:00`).getTime() <=
        new Date(`${historyEndDate}T00:00:00`).getTime());

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

  const reportQuery = api.finance.report.useQuery(
    {
      groupId: activeGroupId ?? "",
      range: historyRange,
      startDate:
        historyRange === "custom"
          ? new Date(`${historyStartDate}T00:00:00`)
          : undefined,
      endDate:
        historyRange === "custom"
          ? (() => {
              const end = new Date(`${historyEndDate}T00:00:00`);
              end.setDate(end.getDate() + 1);
              return end;
            })()
          : undefined,
    },
    {
      enabled: isAuthed && Boolean(activeGroupId) && hasValidCustomRange,
    },
  );

  const historyQuery = api.finance.history.useQuery(
    {
      groupId: activeGroupId ?? "",
      range: historyRange,
      startDate:
        historyRange === "custom"
          ? new Date(`${historyStartDate}T00:00:00`)
          : undefined,
      endDate:
        historyRange === "custom"
          ? (() => {
              const end = new Date(`${historyEndDate}T00:00:00`);
              end.setDate(end.getDate() + 1);
              return end;
            })()
          : undefined,
      take: 150,
    },
    {
      enabled: isAuthed && Boolean(activeGroupId) && hasValidCustomRange,
    },
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
        utils.finance.history.invalidate(),
        utils.finance.report.invalidate(),
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
        utils.finance.history.invalidate(),
        utils.finance.report.invalidate(),
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
        utils.finance.history.invalidate(),
        utils.finance.report.invalidate(),
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

  const currency = groupDetails.data?.group.currency ?? "USD";
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
  const sidebarExpanded = isMobileLayout || !sidebarCollapsed;
  const historyData = hasValidCustomRange ? historyQuery.data : undefined;

  const filteredExpenses = useMemo(() => {
    return (historyData?.expenses ?? []).filter((expense) => {
      if (historyMemberFilter === "all") return true;
      return isMemberIncluded(historyMemberFilter, [
        expense.paidByMemberId,
        expense.createdByMemberId,
        ...expense.participantIds,
      ]);
    });
  }, [historyData?.expenses, historyMemberFilter]);

  const filteredSettlements = useMemo(() => {
    return (historyData?.settlements ?? []).filter((settlement) => {
      if (historyMemberFilter === "all") return true;
      return isMemberIncluded(historyMemberFilter, [
        settlement.payerMemberId,
        settlement.receiverMemberId,
      ]);
    });
  }, [historyData?.settlements, historyMemberFilter]);

  const filteredWalletEntries = useMemo(() => {
    return (historyData?.walletEntries ?? []).filter((entry) => {
      if (historyMemberFilter === "all") return true;
      return isMemberIncluded(historyMemberFilter, [
        entry.memberId,
        ...entry.participantIds,
      ]);
    });
  }, [historyData?.walletEntries, historyMemberFilter]);

  const selectedHistoryMember = useMemo(() => {
    if (historyMemberFilter === "all") return null;
    return (
      historyData?.members.find((member) => member.id === historyMemberFilter) ??
      members.find((member) => member.id === historyMemberFilter) ??
      null
    );
  }, [historyData?.members, historyMemberFilter, members]);

  const selectedHistoryMemberSummary = useMemo(() => {
    if (!selectedHistoryMember) return null;

    const directPaid = filteredExpenses.reduce(
      (sum, expense) =>
        sum +
        (expense.paidByMemberId === selectedHistoryMember.id
          ? expense.amount
          : 0),
      0,
    );
    const shareOfExpenses = filteredExpenses.reduce(
      (sum, expense) =>
        sum +
        (expense.participants.find(
          (participant) => participant.memberId === selectedHistoryMember.id,
        )?.share ?? 0),
      0,
    );
    const settlementsPaid = filteredSettlements.reduce(
      (sum, settlement) =>
        sum +
        (settlement.payerMemberId === selectedHistoryMember.id
          ? settlement.amount
          : 0),
      0,
    );
    const settlementsReceived = filteredSettlements.reduce(
      (sum, settlement) =>
        sum +
        (settlement.receiverMemberId === selectedHistoryMember.id
          ? settlement.amount
          : 0),
      0,
    );
    const walletTopUps = filteredWalletEntries.reduce(
      (sum, entry) =>
        sum +
        (entry.memberId === selectedHistoryMember.id && entry.signedAmount > 0
          ? entry.signedAmount
          : 0),
      0,
    );
    const walletExpenseShare = filteredWalletEntries.reduce((sum, entry) => {
      const participantShare =
        entry.participants.find(
          (participant) => participant.memberId === selectedHistoryMember.id,
        )?.share ?? 0;
      return sum + participantShare;
    }, 0);

    return {
      directPaid,
      shareOfExpenses,
      settlementsPaid,
      settlementsReceived,
      walletTopUps,
      walletExpenseShare,
      transactionCount:
        filteredExpenses.length +
        filteredSettlements.length +
        filteredWalletEntries.length,
    };
  }, [
    filteredExpenses,
    filteredSettlements,
    filteredWalletEntries,
    selectedHistoryMember,
  ]);

  const historyTimeline = useMemo(() => {
    const items = [
      ...filteredExpenses.map((expense) => ({
        id: `expense-${expense.id}`,
        nature: "expense" as const,
        date: expense.date,
        amount: expense.amount,
        heading: expense.title,
        note: expense.notes,
        summary:
          expense.paymentSource === "WALLET"
            ? "Paid from the shared wallet"
            : `${expense.paidByName ?? "Unknown"} paid personally`,
        details: `${niceLabel(expense.category)} • ${expense.participants.length} participant${
          expense.participants.length === 1 ? "" : "s"
        }`,
        people: expense.participants
          .map(
            (participant) =>
              `${participant.name} ${formatMoney(participant.share, currency)}`,
          )
          .join(" • "),
      })),
      ...filteredSettlements.map((settlement) => ({
        id: `settlement-${settlement.id}`,
        nature: "settlement" as const,
        date: settlement.date,
        amount: settlement.amount,
        heading:
          settlement.note?.trim() && settlement.note.trim().length > 0
            ? settlement.note.trim()
            : "Settlement payment",
        note: settlement.note,
        summary: `${settlement.payerName} paid ${settlement.receiverName}`,
        details: "Balance settlement",
        people: `${settlement.payerName} -> ${settlement.receiverName}`,
      })),
      ...filteredWalletEntries.map((entry) => ({
        id: `wallet-${entry.id}`,
        nature: "wallet" as const,
        date: entry.date,
        amount: Math.abs(entry.signedAmount),
        signedAmount: entry.signedAmount,
        heading:
          entry.expenseTitle ??
          entry.note?.trim() ??
          `${niceLabel(entry.type)} entry`,
        note: entry.note,
        summary:
          entry.signedAmount >= 0
            ? `${entry.memberName ?? "Shared wallet"} added funds`
            : `${entry.memberName ?? "Shared wallet"} used wallet funds`,
        details: `${niceLabel(entry.type)} • Wallet balance after ${formatMoney(
          entry.balanceAfter,
          currency,
        )}`,
        people:
          entry.participants.length > 0
            ? entry.participants
                .map(
                  (participant) =>
                    `${participant.name} ${formatMoney(
                      participant.share,
                      currency,
                    )}`,
                )
                .join(" • ")
            : entry.memberName ?? "Shared wallet",
      })),
    ].filter((item) =>
      historyNatureFilter === "all"
        ? true
        : item.nature === historyNatureFilter,
    );

    return items.sort(
      (left, right) =>
        new Date(right.date).getTime() - new Date(left.date).getTime(),
    );
  }, [
    currency,
    filteredExpenses,
    filteredSettlements,
    filteredWalletEntries,
    historyNatureFilter,
  ]);

  const recentExpenseRecords = historyData?.expenses.slice(0, 4) ?? [];
  const recentSettlementRecords = historyData?.settlements.slice(0, 4) ?? [];
  const recentWalletRecords = historyData?.walletEntries.slice(0, 4) ?? [];

  useEffect(() => {
    const updateViewportState = () => {
      const mobile = window.innerWidth < 1024;
      setIsMobileLayout(mobile);
      if (!mobile) setSidebarOpen(false);
    };

    const storedTheme = window.localStorage.getItem("wepay-theme");
    if (storedTheme === "dark" || storedTheme === "light") {
      setThemeMode(storedTheme);
    }

    updateViewportState();
    window.addEventListener("resize", updateViewportState);

    return () => window.removeEventListener("resize", updateViewportState);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    window.localStorage.setItem("wepay-theme", themeMode);
  }, [themeMode]);

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
    setDashboardTab("overview");
    setHistoryMemberFilter("all");
    setHistoryNatureFilter("all");
    if (isMobileLayout) {
      setSidebarOpen(false);
    }
  }, [activeGroupId, isMobileLayout]);

  useEffect(() => {
    if (
      historyMemberFilter !== "all" &&
      !members.some((member) => member.id === historyMemberFilter)
    ) {
      setHistoryMemberFilter("all");
    }
  }, [historyMemberFilter, members]);

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
      <main
        data-theme={themeMode}
        className="wepay-shell wepay-app-shell min-h-screen px-4 py-8 text-slate-900 md:px-8"
      >
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
      <main
        data-theme={themeMode}
        className="wepay-shell wepay-app-shell min-h-screen px-4 py-6 text-slate-900 md:px-8 lg:py-10"
      >
        <div className="mx-auto mb-4 flex w-full max-w-6xl justify-end">
          <button
            type="button"
            onClick={() =>
              setThemeMode((prev) => (prev === "dark" ? "light" : "dark"))
            }
            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            {themeMode === "dark" ? "Switch to light" : "Switch to dark"}
          </button>
        </div>
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

  return (
    <main
      data-theme={themeMode}
      className="wepay-shell wepay-app-shell min-h-screen px-3 py-4 text-slate-900 sm:px-4 md:px-6 md:py-6"
    >
      {isMobileLayout && sidebarOpen && (
        <button
          type="button"
          aria-label="Close sidebar"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-slate-950/55 backdrop-blur-[2px] lg:hidden"
        />
      )}

      <div className="mx-auto max-w-[96rem]">
        <div className="wepay-main-panel mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[24px] border px-3 py-3 shadow-[0_20px_70px_-48px_rgba(15,23,42,0.55)] sm:px-4">
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() =>
                isMobileLayout
                  ? setSidebarOpen((prev) => !prev)
                  : setSidebarCollapsed((prev) => !prev)
              }
              className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              {isMobileLayout
                ? sidebarOpen
                  ? "Close"
                  : "Menu"
                : sidebarCollapsed
                  ? "Expand"
                  : "Collapse"}
            </button>
            <div>
              <p className="text-xs font-semibold tracking-[0.22em] text-slate-500 uppercase">
                Wepay dashboard
              </p>
              <p className="mt-1 text-sm text-slate-600">
                Responsive workspace with a collapsible sidebar and theme toggle.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() =>
              setThemeMode((prev) => (prev === "dark" ? "light" : "dark"))
            }
            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            {themeMode === "dark" ? "Switch to light" : "Switch to dark"}
          </button>
        </div>

        <div
          className={`grid gap-4 ${
            sidebarExpanded
              ? "lg:grid-cols-[320px_minmax(0,1fr)]"
              : "lg:grid-cols-[96px_minmax(0,1fr)]"
          }`}
        >
          <section
            className={`wepay-sidebar wepay-scroll fixed inset-y-3 left-3 z-50 w-[min(86vw,320px)] rounded-[30px] border p-4 shadow-[0_28px_90px_-50px_rgba(15,23,42,0.8)] transition-transform duration-300 lg:sticky lg:top-6 lg:z-auto lg:h-[calc(100vh-3rem)] lg:w-auto lg:translate-x-0 ${
              sidebarOpen || !isMobileLayout
                ? "translate-x-0"
                : "-translate-x-[calc(100%+1rem)]"
            } ${sidebarExpanded ? "lg:p-5" : "lg:p-3"}`}
          >
            {sidebarExpanded ? (
              <>
                <div className="wepay-sidebar-surface rounded-[26px] border p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold tracking-[0.24em] text-white/55 uppercase">
                        Signed in
                      </p>
                      <h1 className="font-heading mt-3 text-4xl">Wepay</h1>
                    </div>
                    {isMobileLayout && (
                      <button
                        type="button"
                        onClick={() => setSidebarOpen(false)}
                        className="rounded-2xl border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/15"
                      >
                        Close
                      </button>
                    )}
                  </div>
                  <p className="mt-2 text-sm text-white/80">
                    {session.user.name ?? session.user.email}
                  </p>
                  <p className="mt-2 text-xs text-white/55">
                    Traditional group ledger with a clear sidebar, records, and
                    history.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {!isMobileLayout && (
                      <button
                        type="button"
                        onClick={() => setSidebarCollapsed(true)}
                        className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/15"
                      >
                        Collapse
                      </button>
                    )}
                    <button
                      onClick={() => signOut({ redirectTo: "/" })}
                      className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/15"
                    >
                      Sign out
                    </button>
                  </div>
                </div>

                <div className="mt-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold tracking-[0.22em] text-white/45 uppercase">
                        Your groups
                      </p>
                      <p className="mt-1 text-sm text-white/65">
                        Switch between spaces or start a new one.
                      </p>
                    </div>
                    {groupsQuery.isFetching && (
                      <span className="text-xs font-semibold text-white/45">
                        Refreshing...
                      </span>
                    )}
                  </div>

                  <FeedbackBanner feedback={workspaceFeedback} className="mt-4" />

                  <div className="wepay-scroll mt-4 max-h-[16rem] space-y-2 overflow-y-auto pr-1">
                    {groupsQuery.isLoading && (
                      <div className="wepay-sidebar-surface rounded-2xl border px-4 py-4 text-sm text-white/70">
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
                        onClick={() => {
                          setActiveGroupId(group.id);
                          if (isMobileLayout) setSidebarOpen(false);
                        }}
                        className={`w-full rounded-[24px] border px-4 py-4 text-left transition ${
                          activeGroupId === group.id
                            ? "border-amber-300 bg-amber-100 text-slate-950 shadow-lg"
                            : "border-white/10 bg-white/5 text-white hover:border-white/20 hover:bg-white/10"
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
                        <div className="mt-3 flex items-center justify-between text-xs opacity-75">
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
                        <div className="wepay-sidebar-surface rounded-[24px] border border-dashed px-4 py-5 text-sm text-white/70">
                          You are not in a group yet. Create one below or join
                          with a private code.
                        </div>
                      )}
                  </div>
                </div>

                <div className="wepay-sidebar-surface mt-6 rounded-[28px] border p-4">
                  <div>
                    <h2 className="text-sm font-semibold tracking-[0.2em] text-white/45 uppercase">
                      Create a group
                    </h2>
                    <p className="mt-1 text-sm text-white/65">
                      Set up a new private workspace for roommates, trips, or
                      friends.
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
                      className="w-full rounded-2xl border border-white/10 bg-white/90 px-4 py-3 text-sm text-slate-900 transition outline-none focus:border-amber-300"
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
                      className="h-24 w-full rounded-2xl border border-white/10 bg-white/90 px-4 py-3 text-sm text-slate-900 transition outline-none focus:border-amber-300"
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
                        className="rounded-2xl border border-white/10 bg-white/90 px-4 py-3 text-sm text-slate-900 transition outline-none focus:border-amber-300"
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
                        className="rounded-2xl border border-white/10 bg-white/90 px-4 py-3 text-sm text-slate-900 uppercase transition outline-none focus:border-amber-300"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={createGroup.isPending || isWorkspaceBusy}
                      className="w-full rounded-2xl bg-amber-300 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:bg-amber-100"
                    >
                      {createGroup.isPending
                        ? "Creating..."
                        : "Create private group"}
                    </button>
                  </form>
                </div>

                <div className="mt-4 rounded-[28px] border border-white/10 bg-white p-4 text-slate-900">
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
              </>
            ) : (
              <div className="flex h-full flex-col items-center gap-3 py-2">
                <button
                  type="button"
                  onClick={() => setSidebarCollapsed(false)}
                  className="w-full rounded-2xl border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/15"
                >
                  Open
                </button>
                <div className="wepay-sidebar-surface flex h-14 w-14 items-center justify-center rounded-[20px] border text-lg font-semibold">
                  W
                </div>
                <div className="wepay-scroll flex w-full flex-1 flex-col gap-2 overflow-y-auto">
                  {groupsQuery.data?.map((group) => (
                    <button
                      key={group.id}
                      type="button"
                      onClick={() => setActiveGroupId(group.id)}
                      title={group.name}
                      className={`flex h-12 w-full items-center justify-center rounded-2xl border text-sm font-semibold transition ${
                        activeGroupId === group.id
                          ? "border-amber-300 bg-amber-100 text-slate-950"
                          : "border-white/10 bg-white/5 text-white hover:bg-white/10"
                      }`}
                    >
                      {group.name.slice(0, 1).toUpperCase()}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => signOut({ redirectTo: "/" })}
                  className="w-full rounded-2xl border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/15"
                >
                  Sign out
                </button>
              </div>
            )}
          </section>

          <section className="wepay-main-panel wepay-scroll rounded-[32px] border p-4 shadow-[0_28px_90px_-50px_rgba(15,23,42,0.45)] backdrop-blur sm:p-5">
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

              <div className="mt-5 flex flex-wrap gap-2 rounded-2xl bg-slate-100 p-2">
                {(
                  [
                    { key: "overview", label: "Overview" },
                    { key: "records", label: "Records" },
                    { key: "history", label: "History" },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setDashboardTab(tab.key)}
                    className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                      dashboardTab === tab.key
                        ? "bg-slate-900 text-white"
                        : "text-slate-600 hover:bg-white hover:text-slate-900"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {dashboardTab === "overview" && (
                <>
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

                  <div className="mt-5 grid gap-3 xl:grid-cols-2">
                    <section className="rounded-[28px] border border-slate-200 bg-white p-5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="font-semibold">Member balances</h3>
                          <p className="mt-1 text-sm text-slate-600">
                            Positive means member should receive. Negative means
                            member owes.
                          </p>
                        </div>
                        <span className="text-xs font-semibold text-slate-500">
                          {members.length} people
                        </span>
                      </div>

                      <div className="mt-4 space-y-2 text-sm">
                        {dashboard.data.balances.memberBalances.map(
                          (member) => (
                            <div
                              key={member.memberId}
                              className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-medium text-slate-700">
                                  {member.name}
                                </span>
                                <span className="font-semibold">
                                  {formatMoney(member.netBalance, currency)}
                                </span>
                              </div>
                              <p className="mt-1 text-xs text-slate-500">
                                Paid personally:{" "}
                                {formatMoney(member.personalPaid, currency)} |
                                Wallet funded:{" "}
                                {formatMoney(
                                  member.walletExpensesFunded,
                                  currency,
                                )}{" "}
                                | Settlements paid:{" "}
                                {formatMoney(member.settlementsPaid, currency)}{" "}
                                | Settlements received:{" "}
                                {formatMoney(
                                  member.settlementsReceived,
                                  currency,
                                )}
                              </p>
                            </div>
                          ),
                        )}
                      </div>
                    </section>

                    <section className="rounded-[28px] border border-slate-200 bg-white p-5">
                      <h3 className="font-semibold">Suggested settlements</h3>
                      <p className="mt-1 text-sm text-slate-600">
                        Suggested quickest payment path to clear balances.
                      </p>

                      <div className="mt-4 space-y-2 text-sm">
                        {dashboard.data.suggestions.length === 0 && (
                          <div className="rounded-2xl bg-slate-50 px-4 py-4 text-slate-600">
                            No pending suggestions right now. Your group is
                            balanced.
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
                  </div>
                </>
              )}

              {dashboardTab === "records" && (
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
                          Record a purchase and split equally across selected
                          members.
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
                      <div className="wepay-scroll mt-2 max-h-40 space-y-2 overflow-y-auto">
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
                      {addExpense.isPending
                        ? "Saving expense..."
                        : "Add expense"}
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
                      Add money to the shared wallet for upcoming group
                      expenses.
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
                      {addFund.isPending
                        ? "Updating wallet..."
                        : "Add to wallet"}
                    </button>
                  </form>

                  <form
                    className="rounded-[28px] border border-slate-200 bg-white p-5"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!myMember.data) return;

                      const amount = Number(settleForm.amount);

                      if (!Number.isFinite(amount) || amount <= 0) {
                        setWorkspaceFeedback({
                          type: "error",
                          message: "Enter a valid settlement amount.",
                        });
                        return;
                      }

                      if (
                        !settleForm.receiverMemberId ||
                        settleForm.receiverMemberId === myMember.data.memberId
                      ) {
                        setWorkspaceFeedback({
                          type: "error",
                          message:
                            "Choose another member to receive this settlement.",
                        });
                        return;
                      }

                      addSettlement.mutate({
                        groupId: activeGroupId,
                        payerMemberId: myMember.data.memberId,
                        receiverMemberId: settleForm.receiverMemberId,
                        amount,
                        note: settleForm.note.trim() || undefined,
                      });
                    }}
                  >
                    <h3 className="font-semibold">Record settlement</h3>
                    <p className="mt-1 text-sm text-slate-600">
                      Only your member account can be used as payer for this
                      entry.
                    </p>

                    <p className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
                      Paid by:{" "}
                      <span className="font-semibold">
                        {session.user.name ?? "You"}
                      </span>
                    </p>

                    <div className="mt-4 space-y-3">
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
                        {members
                          .filter(
                            (member) => member.id !== myMember.data?.memberId,
                          )
                          .map((member) => (
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

                    <div className="mt-3 space-y-2 text-xs">
                      {dashboard.data.suggestions
                        .filter(
                          (suggestion) =>
                            suggestion.fromMemberId === myMember.data?.memberId,
                        )
                        .slice(0, 2)
                        .map((suggestion, index) => (
                          <button
                            key={`${suggestion.toMemberId}-${index}`}
                            type="button"
                            onClick={() =>
                              setSettleForm((prev) => ({
                                ...prev,
                                receiverMemberId: suggestion.toMemberId,
                                amount: suggestion.amount.toFixed(2),
                              }))
                            }
                            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left text-slate-700 hover:bg-slate-100"
                          >
                            Use suggestion: pay{" "}
                            {memberMap.get(suggestion.toMemberId)}{" "}
                            {formatMoney(suggestion.amount, currency)}
                          </button>
                        ))}
                    </div>

                    <button
                      type="submit"
                      disabled={addSettlement.isPending || !myMember.data}
                      className="mt-4 w-full rounded-2xl bg-emerald-400 px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-emerald-200"
                    >
                      {addSettlement.isPending
                        ? "Recording..."
                        : "Record settlement"}
                    </button>
                  </form>
                </div>
              )}


              {dashboardTab === "records" && (
                <section className="mt-5 rounded-[28px] border border-slate-200 bg-white p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">Detailed records</h3>
                      <p className="mt-1 text-sm text-slate-600">
                        Recent expenses, settlements, and wallet activity for
                        the selected reporting period.
                      </p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">
                      {reportQuery.data
                        ? formatRangeLabel(
                            reportQuery.data.range.start,
                            reportQuery.data.range.end,
                          )
                        : "Waiting for history"}
                    </span>
                  </div>

                  {!hasValidCustomRange && (
                    <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                      Choose a custom end date that is on or after the start
                      date to load records.
                    </div>
                  )}

                  <div className="mt-4 grid gap-3 xl:grid-cols-3">
                    <section className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="font-semibold">Expenses</h4>
                        <span className="text-xs font-semibold text-slate-500">
                          {recentExpenseRecords.length}
                        </span>
                      </div>
                      <div className="mt-3 space-y-2">
                        {recentExpenseRecords.length === 0 && (
                          <p className="rounded-xl bg-white px-3 py-3 text-sm text-slate-500">
                            No expenses in this period.
                          </p>
                        )}
                        {recentExpenseRecords.map((expense) => (
                          <div
                            key={expense.id}
                            className="rounded-xl bg-white px-3 py-3 text-sm"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="font-medium text-slate-800">
                                {expense.title}
                              </p>
                              <p className="font-semibold text-slate-900">
                                {formatMoney(expense.amount, currency)}
                              </p>
                            </div>
                            <p className="mt-1 text-xs text-slate-500">
                              {formatDate(expense.date)} | {niceLabel(expense.category)} | {expense.paymentSource === "WALLET"
                                ? "Shared wallet"
                                : expense.paidByName ?? "Unknown payer"}
                            </p>
                            <p className="mt-1 text-xs text-slate-600">
                              {expense.participants
                                .map(
                                  (participant) =>
                                    `${participant.name} ${formatMoney(
                                      participant.share,
                                      currency,
                                    )}`,
                                )
                                .join(" | ")}
                            </p>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="font-semibold">Settlements</h4>
                        <span className="text-xs font-semibold text-slate-500">
                          {recentSettlementRecords.length}
                        </span>
                      </div>
                      <div className="mt-3 space-y-2">
                        {recentSettlementRecords.length === 0 && (
                          <p className="rounded-xl bg-white px-3 py-3 text-sm text-slate-500">
                            No settlements in this period.
                          </p>
                        )}
                        {recentSettlementRecords.map((settlement) => (
                          <div
                            key={settlement.id}
                            className="rounded-xl bg-white px-3 py-3 text-sm"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="font-medium text-slate-800">
                                {settlement.payerName}{" -> "}{settlement.receiverName}
                              </p>
                              <p className="font-semibold text-slate-900">
                                {formatMoney(settlement.amount, currency)}
                              </p>
                            </div>
                            <p className="mt-1 text-xs text-slate-500">
                              {formatDate(settlement.date)}
                            </p>
                            <p className="mt-1 text-xs text-slate-600">
                              {settlement.note ?? "Settlement recorded"}
                            </p>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="font-semibold">Wallet ledger</h4>
                        <span className="text-xs font-semibold text-slate-500">
                          {recentWalletRecords.length}
                        </span>
                      </div>
                      <div className="mt-3 space-y-2">
                        {recentWalletRecords.length === 0 && (
                          <p className="rounded-xl bg-white px-3 py-3 text-sm text-slate-500">
                            No wallet entries in this period.
                          </p>
                        )}
                        {recentWalletRecords.map((entry) => (
                          <div
                            key={entry.id}
                            className="rounded-xl bg-white px-3 py-3 text-sm"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="font-medium text-slate-800">
                                {entry.expenseTitle ??
                                  entry.note ??
                                  niceLabel(entry.type)}
                              </p>
                              <p
                                className={`font-semibold ${
                                  entry.signedAmount >= 0
                                    ? "text-emerald-700"
                                    : "text-rose-700"
                                }`}
                              >
                                {entry.signedAmount >= 0 ? "+" : "-"}
                                {formatMoney(
                                  Math.abs(entry.signedAmount),
                                  currency,
                                )}
                              </p>
                            </div>
                            <p className="mt-1 text-xs text-slate-500">
                              {formatDate(entry.date)} | {niceLabel(entry.type)} | Balance after {formatMoney(entry.balanceAfter, currency)}
                            </p>
                            <p className="mt-1 text-xs text-slate-600">
                              {entry.participants.length > 0
                                ? entry.participants
                                    .map(
                                      (participant) =>
                                        `${participant.name} ${formatMoney(
                                          participant.share,
                                          currency,
                                        )}`,
                                    )
                                    .join(" | ")
                                : entry.memberName ?? "Shared wallet"}
                            </p>
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>
                </section>
              )}              {dashboardTab === "history" && (
                <section className="mt-5 rounded-[28px] border border-slate-200 bg-white p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">History and reports</h3>
                      <p className="mt-1 text-sm text-slate-600">
                        Review weekly, monthly, or custom periods and filter the
                        timeline by member or transaction type.
                      </p>
                    </div>

                    <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">
                      {reportQuery.data
                        ? formatRangeLabel(
                            reportQuery.data.range.start,
                            reportQuery.data.range.end,
                          )
                        : "Choose a period"}
                    </span>
                  </div>

                  <div className="mt-4 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          { key: "week", label: "Weekly" },
                          { key: "month", label: "Monthly" },
                          { key: "custom", label: "Custom" },
                        ] as const
                      ).map((option) => (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => setHistoryRange(option.key)}
                          className={`rounded-xl px-3 py-2 text-xs font-semibold ${
                            historyRange === option.key
                              ? "bg-slate-900 text-white"
                              : "bg-white text-slate-600"
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>

                    <div className="mt-4 grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="text-sm text-slate-600">
                          Person filter
                          <select
                            value={historyMemberFilter}
                            onChange={(event) =>
                              setHistoryMemberFilter(event.target.value)
                            }
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-400"
                          >
                            <option value="all">All members</option>
                            {(historyData?.members ?? members).map((member) => (
                              <option key={member.id} value={member.id}>
                                {member.name}
                              </option>
                            ))}
                          </select>
                        </label>

                        <div>
                          <p className="text-sm text-slate-600">
                            Transaction filter
                          </p>
                          <div className="mt-1 flex flex-wrap gap-2">
                            {(
                              [
                                { key: "all", label: "All" },
                                { key: "expense", label: "Expenses" },
                                { key: "settlement", label: "Settlements" },
                                { key: "wallet", label: "Wallet" },
                              ] as const
                            ).map((option) => (
                              <button
                                key={option.key}
                                type="button"
                                onClick={() => setHistoryNatureFilter(option.key)}
                                className={`rounded-full px-3 py-2 text-xs font-semibold ${
                                  historyNatureFilter === option.key
                                    ? "bg-slate-900 text-white"
                                    : "bg-white text-slate-600"
                                }`}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      {historyRange === "custom" && (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="text-sm text-slate-600">
                            Start date
                            <input
                              type="date"
                              value={historyStartDate}
                              onChange={(event) =>
                                setHistoryStartDate(event.target.value)
                              }
                              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-400"
                            />
                          </label>
                          <label className="text-sm text-slate-600">
                            End date
                            <input
                              type="date"
                              value={historyEndDate}
                              onChange={(event) =>
                                setHistoryEndDate(event.target.value)
                              }
                              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-400"
                            />
                          </label>
                        </div>
                      )}
                    </div>

                    {!hasValidCustomRange && (
                      <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                        The custom date range is invalid. Set the end date on or
                        after the start date to load history.
                      </div>
                    )}
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                    <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs font-semibold tracking-[0.16em] text-slate-500 uppercase">
                        Spent
                      </p>
                      <p className="mt-2 text-xl font-semibold">
                        {formatMoney(
                          reportQuery.data?.currentSummary.totalSpent ?? 0,
                          currency,
                        )}
                      </p>
                    </article>
                    <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs font-semibold tracking-[0.16em] text-slate-500 uppercase">
                        Wallet used
                      </p>
                      <p className="mt-2 text-xl font-semibold">
                        {formatMoney(
                          reportQuery.data?.currentSummary.walletUsed ?? 0,
                          currency,
                        )}
                      </p>
                    </article>
                    <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs font-semibold tracking-[0.16em] text-slate-500 uppercase">
                        Wallet top-ups
                      </p>
                      <p className="mt-2 text-xl font-semibold">
                        {formatMoney(
                          reportQuery.data?.currentSummary.walletTopUps ?? 0,
                          currency,
                        )}
                      </p>
                    </article>
                    <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs font-semibold tracking-[0.16em] text-slate-500 uppercase">
                        Settlements
                      </p>
                      <p className="mt-2 text-xl font-semibold">
                        {formatMoney(
                          reportQuery.data?.currentSummary.settlementsTotal ?? 0,
                          currency,
                        )}
                      </p>
                    </article>
                    <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs font-semibold tracking-[0.16em] text-slate-500 uppercase">
                        Avg per day
                      </p>
                      <p className="mt-2 text-xl font-semibold">
                        {formatMoney(
                          reportQuery.data?.currentSummary.averagePerDay ?? 0,
                          currency,
                        )}
                      </p>
                    </article>
                    <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs font-semibold tracking-[0.16em] text-slate-500 uppercase">
                        Delta vs previous
                      </p>
                      <p className="mt-2 text-xl font-semibold">
                        {formatMoney(
                          reportQuery.data?.spendDelta ?? 0,
                          currency,
                        )}
                      </p>
                    </article>
                  </div>

                  <div className="mt-5 grid gap-3 xl:grid-cols-[1.45fr_0.85fr]">
                    <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h4 className="font-semibold">Detailed timeline</h4>
                          <p className="mt-1 text-sm text-slate-600">
                            Filtered by member and transaction nature.
                          </p>
                        </div>
                        <span className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-600">
                          {historyTimeline.length} records
                        </span>
                      </div>

                      <div className="wepay-scroll mt-4 max-h-[52rem] space-y-3 overflow-y-auto pr-1">
                        {historyQuery.isLoading && hasValidCustomRange && (
                          <div className="rounded-2xl bg-white px-4 py-4 text-sm text-slate-600">
                            Loading filtered activity...
                          </div>
                        )}

                        {!historyQuery.isLoading &&
                          hasValidCustomRange &&
                          historyTimeline.length === 0 && (
                            <div className="rounded-2xl bg-white px-4 py-4 text-sm text-slate-600">
                              No records found for this filter combination.
                            </div>
                          )}

                        {historyTimeline.map((item) => (
                          <article
                            key={item.id}
                            className="rounded-[22px] border border-slate-200 bg-white px-4 py-4"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span
                                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-[0.14em] uppercase ${
                                      item.nature === "expense"
                                        ? "bg-amber-100 text-amber-900"
                                        : item.nature === "settlement"
                                          ? "bg-emerald-100 text-emerald-900"
                                          : "bg-sky-100 text-sky-900"
                                    }`}
                                  >
                                    {item.nature}
                                  </span>
                                  <p className="text-base font-semibold text-slate-800">
                                    {item.heading}
                                  </p>
                                </div>
                                <p className="mt-2 text-sm text-slate-600">
                                  {item.summary}
                                </p>
                              </div>
                              <div className="text-right">
                                <p
                                  className={`text-lg font-semibold ${
                                    item.nature === "wallet" &&
                                    "signedAmount" in item &&
                                    item.signedAmount < 0
                                      ? "text-rose-700"
                                      : item.nature === "wallet" &&
                                          "signedAmount" in item &&
                                          item.signedAmount > 0
                                        ? "text-emerald-700"
                                        : "text-slate-900"
                                  }`}
                                >
                                  {item.nature === "wallet" &&
                                  "signedAmount" in item
                                    ? `${item.signedAmount >= 0 ? "+" : "-"}${formatMoney(
                                        Math.abs(item.signedAmount),
                                        currency,
                                      )}`
                                    : formatMoney(item.amount, currency)}
                                </p>
                                <p className="mt-1 text-xs text-slate-500">
                                  {formatDate(item.date)}
                                </p>
                              </div>
                            </div>

                            <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                              <div className="rounded-xl bg-slate-50 px-3 py-2">
                                {item.details}
                              </div>
                              <div className="rounded-xl bg-slate-50 px-3 py-2">
                                {item.people}
                              </div>
                            </div>

                            {item.note && item.note !== item.heading && (
                              <p className="mt-3 text-sm text-slate-600">
                                {item.note}
                              </p>
                            )}
                          </article>
                        ))}
                      </div>
                    </div>

                    <div className="grid gap-3">
                      <section className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                        <h4 className="font-semibold">
                          {selectedHistoryMember
                            ? `${selectedHistoryMember.name} snapshot`
                            : "Group snapshot"}
                        </h4>
                        <p className="mt-1 text-sm text-slate-600">
                          {selectedHistoryMember
                            ? "Every figure below is filtered to this member's involvement."
                            : "Select a member to inspect their full transaction history."}
                        </p>

                        <div className="mt-4 grid gap-2 sm:grid-cols-2">
                          <div className="rounded-xl bg-white px-3 py-3">
                            <p className="text-xs font-semibold tracking-[0.14em] text-slate-500 uppercase">
                              Expenses
                            </p>
                            <p className="mt-2 text-lg font-semibold">
                              {filteredExpenses.length}
                            </p>
                          </div>
                          <div className="rounded-xl bg-white px-3 py-3">
                            <p className="text-xs font-semibold tracking-[0.14em] text-slate-500 uppercase">
                              Settlements
                            </p>
                            <p className="mt-2 text-lg font-semibold">
                              {filteredSettlements.length}
                            </p>
                          </div>
                          <div className="rounded-xl bg-white px-3 py-3">
                            <p className="text-xs font-semibold tracking-[0.14em] text-slate-500 uppercase">
                              Wallet entries
                            </p>
                            <p className="mt-2 text-lg font-semibold">
                              {filteredWalletEntries.length}
                            </p>
                          </div>
                          <div className="rounded-xl bg-white px-3 py-3">
                            <p className="text-xs font-semibold tracking-[0.14em] text-slate-500 uppercase">
                              Closing wallet
                            </p>
                            <p className="mt-2 text-lg font-semibold">
                              {formatMoney(
                                historyData?.closingWalletBalance ?? 0,
                                currency,
                              )}
                            </p>
                          </div>
                        </div>

                        {selectedHistoryMemberSummary && (
                          <div className="mt-4 space-y-2 text-sm">
                            <div className="rounded-xl bg-white px-3 py-3 text-slate-700">
                              Paid directly{" "}
                              <span className="font-semibold">
                                {formatMoney(
                                  selectedHistoryMemberSummary.directPaid,
                                  currency,
                                )}
                              </span>
                            </div>
                            <div className="rounded-xl bg-white px-3 py-3 text-slate-700">
                              Share of expenses{" "}
                              <span className="font-semibold">
                                {formatMoney(
                                  selectedHistoryMemberSummary.shareOfExpenses,
                                  currency,
                                )}
                              </span>
                            </div>
                            <div className="rounded-xl bg-white px-3 py-3 text-slate-700">
                              Wallet top-ups{" "}
                              <span className="font-semibold">
                                {formatMoney(
                                  selectedHistoryMemberSummary.walletTopUps,
                                  currency,
                                )}
                              </span>
                            </div>
                            <div className="rounded-xl bg-white px-3 py-3 text-slate-700">
                              Wallet expense share{" "}
                              <span className="font-semibold">
                                {formatMoney(
                                  selectedHistoryMemberSummary.walletExpenseShare,
                                  currency,
                                )}
                              </span>
                            </div>
                            <div className="rounded-xl bg-white px-3 py-3 text-slate-700">
                              Settlements paid{" "}
                              <span className="font-semibold">
                                {formatMoney(
                                  selectedHistoryMemberSummary.settlementsPaid,
                                  currency,
                                )}
                              </span>
                            </div>
                            <div className="rounded-xl bg-white px-3 py-3 text-slate-700">
                              Settlements received{" "}
                              <span className="font-semibold">
                                {formatMoney(
                                  selectedHistoryMemberSummary.settlementsReceived,
                                  currency,
                                )}
                              </span>
                            </div>
                          </div>
                        )}
                      </section>

                      <section className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                        <h4 className="font-semibold">Period insights</h4>
                        <p className="mt-1 text-sm text-slate-600">
                          Quick reporting for the chosen range.
                        </p>
                        <div className="mt-4 space-y-2 text-sm">
                          <div className="rounded-xl bg-white px-3 py-3 text-slate-700">
                            Highest category{" "}
                            <span className="font-semibold">
                              {reportQuery.data?.currentSummary.highestCategory
                                ? `${reportQuery.data.currentSummary.highestCategory.label} ${formatMoney(
                                    reportQuery.data.currentSummary.highestCategory.amount,
                                    currency,
                                  )}`
                                : "No category data yet"}
                            </span>
                          </div>
                          <div className="rounded-xl bg-white px-3 py-3 text-slate-700">
                            Top spender{" "}
                            <span className="font-semibold">
                              {reportQuery.data?.currentSummary.topSpender
                                ? `${reportQuery.data.currentSummary.topSpender.name} ${formatMoney(
                                    reportQuery.data.currentSummary.topSpender.amount,
                                    currency,
                                  )}`
                                : "No spending yet"}
                            </span>
                          </div>
                          <div className="rounded-xl bg-white px-3 py-3 text-slate-700">
                            Top contributor{" "}
                            <span className="font-semibold">
                              {reportQuery.data?.currentSummary.topContributor
                                ? `${reportQuery.data.currentSummary.topContributor.name} ${formatMoney(
                                    reportQuery.data.currentSummary.topContributor.amount,
                                    currency,
                                  )}`
                                : "No contributions yet"}
                            </span>
                          </div>
                          <div className="rounded-xl bg-white px-3 py-3 text-slate-700">
                            Opening wallet{" "}
                            <span className="font-semibold">
                              {formatMoney(
                                historyData?.openingWalletBalance ?? 0,
                                currency,
                              )}
                            </span>
                          </div>
                        </div>
                      </section>

                      <section className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <h4 className="font-semibold">Category breakdown</h4>
                            <p className="mt-1 text-sm text-slate-600">
                              Expenses separated by category for this period.
                            </p>
                          </div>
                          <span className="text-xs font-semibold text-slate-500">
                            {reportQuery.data?.currentSummary.categoryBreakdown
                              .length ?? 0}
                          </span>
                        </div>

                        <div className="mt-4 space-y-3">
                          {(reportQuery.data?.currentSummary.categoryBreakdown ??
                            []).length === 0 && (
                            <div className="rounded-xl bg-white px-3 py-3 text-sm text-slate-500">
                              No category data for this period.
                            </div>
                          )}

                          {(reportQuery.data?.currentSummary.categoryBreakdown ??
                            []).map((category) => {
                            const totalSpent =
                              reportQuery.data?.currentSummary.totalSpent ?? 0;
                            const width =
                              totalSpent > 0
                                ? Math.max(
                                    10,
                                    Math.round((category.amount / totalSpent) * 100),
                                  )
                                : 0;

                            return (
                              <div
                                key={category.key}
                                className="rounded-xl bg-white px-3 py-3"
                              >
                                <div className="flex items-center justify-between gap-3 text-sm">
                                  <span className="font-medium text-slate-700">
                                    {category.label}
                                  </span>
                                  <span className="font-semibold text-slate-900">
                                    {formatMoney(category.amount, currency)}
                                  </span>
                                </div>
                                <div className="mt-2 h-2 rounded-full bg-slate-100">
                                  <div
                                    className="h-2 rounded-full bg-slate-900"
                                    style={{ width: `${width}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    </div>
                  </div>
                </section>
              )}
            </>
          )}
        </section>
      </div>
      </div>
    </main>
  );
}



