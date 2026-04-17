"use client";

import { signIn, signOut, useSession } from "next-auth/react";
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

const groupTypes = [
  "HOME",
  "TRIP",
  "FRIENDS",
  "OFFICE",
  "FAMILY",
  "CLUB",
  "OTHER",
] as const;

export function WepayDashboard() {
  const { data: session, status } = useSession();
  const isAuthed = status === "authenticated";

  const utils = api.useUtils();

  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authError, setAuthError] = useState<string | null>(null);

  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [signupForm, setSignupForm] = useState({
    name: "",
    email: "",
    password: "",
  });

  const groupsQuery = api.group.list.useQuery(undefined, {
    enabled: isAuthed,
  });

  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [createGroupForm, setCreateGroupForm] = useState({
    name: "",
    description: "",
    type: "OTHER" as (typeof groupTypes)[number],
    currency: "USD",
  });
  const [joinCode, setJoinCode] = useState("");

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

  const registerMutation = api.auth.register.useMutation({
    onSuccess: async (_, input) => {
      const result = await signIn("credentials", {
        email: input.email,
        password: input.password,
        redirect: false,
      });
      if (result?.error) {
        setAuthError(result.error);
        return;
      }
      setAuthError(null);
      await utils.group.list.invalidate();
    },
    onError: (err) => setAuthError(err.message),
  });

  const createGroup = api.group.create.useMutation({
    onSuccess: async (result) => {
      await utils.group.list.invalidate();
      setCreateGroupForm({
        name: "",
        description: "",
        type: "OTHER",
        currency: "USD",
      });
      setActiveGroupId(result.groupId);
    },
  });

  const joinByCode = api.group.joinByCode.useMutation({
    onSuccess: async (result) => {
      await utils.group.list.invalidate();
      setJoinCode("");
      setActiveGroupId(result.groupId);
    },
  });

  const addExpense = api.finance.addExpense.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.finance.dashboard.invalidate(),
        utils.group.details.invalidate(),
        utils.group.list.invalidate(),
      ]);
    },
  });

  const addFund = api.finance.addWalletContribution.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.finance.dashboard.invalidate(),
        utils.group.list.invalidate(),
      ]);
    },
  });

  const addSettlement = api.finance.addSettlement.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.finance.dashboard.invalidate(),
        utils.group.details.invalidate(),
      ]);
    },
  });

  const members = useMemo(
    () => groupDetails.data?.group.members ?? [],
    [groupDetails.data?.group.members],
  );
  const memberMap = useMemo(
    () => new Map(members.map((m) => [m.id, m.name])),
    [members],
  );

  const [expenseForm, setExpenseForm] = useState({
    title: "",
    amount: "",
    category: "OTHER" as
      | "GROCERIES"
      | "RENT"
      | "ELECTRICITY"
      | "INTERNET"
      | "CLEANING"
      | "TRANSPORT"
      | "DINING"
      | "TRIP"
      | "MAINTENANCE"
      | "OTHER",
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

  if (status === "loading") {
    return <main className="p-8">Loading session...</main>;
  }

  if (!session?.user) {
    return (
      <main className="min-h-screen bg-[linear-gradient(140deg,#fdf7ed_0%,#f6f1e8_52%,#f2ebde_100%)] px-4 py-10 text-slate-900 md:px-8">
        <div className="mx-auto w-full max-w-xl rounded-3xl border border-slate-900/10 bg-white/85 p-6 shadow-[0_24px_80px_-40px_rgba(0,0,0,0.5)]">
          <h1 className="font-heading text-4xl">Wepay</h1>
          <p className="mt-2 text-sm text-slate-600">
            Private group expenses with shared wallet, settlements, and
            weekly/monthly summaries.
          </p>

          <div className="mt-5 flex gap-2 rounded-full bg-slate-100 p-1">
            <button
              onClick={() => setAuthMode("login")}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
                authMode === "login"
                  ? "bg-slate-900 text-white"
                  : "text-slate-600"
              }`}
            >
              Login
            </button>
            <button
              onClick={() => setAuthMode("signup")}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
                authMode === "signup"
                  ? "bg-slate-900 text-white"
                  : "text-slate-600"
              }`}
            >
              Sign Up
            </button>
          </div>

          {authMode === "login" && (
            <form
              className="mt-4 space-y-2"
              onSubmit={async (event) => {
                event.preventDefault();
                setAuthError(null);
                const result = await signIn("credentials", {
                  email: loginForm.email,
                  password: loginForm.password,
                  redirect: false,
                });
                if (result?.error) {
                  setAuthError("Invalid credentials.");
                }
              }}
            >
              <input
                type="email"
                placeholder="Email"
                value={loginForm.email}
                onChange={(e) =>
                  setLoginForm((p) => ({ ...p, email: e.target.value }))
                }
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                required
              />
              <input
                type="password"
                placeholder="Password"
                value={loginForm.password}
                onChange={(e) =>
                  setLoginForm((p) => ({ ...p, password: e.target.value }))
                }
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                required
              />
              <button className="w-full rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white">
                Login
              </button>
            </form>
          )}

          {authMode === "signup" && (
            <form
              className="mt-4 space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                setAuthError(null);
                registerMutation.mutate(signupForm);
              }}
            >
              <input
                placeholder="Name"
                value={signupForm.name}
                onChange={(e) =>
                  setSignupForm((p) => ({ ...p, name: e.target.value }))
                }
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                required
              />
              <input
                type="email"
                placeholder="Email"
                value={signupForm.email}
                onChange={(e) =>
                  setSignupForm((p) => ({ ...p, email: e.target.value }))
                }
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                required
              />
              <input
                type="password"
                placeholder="Password (min 8 chars)"
                value={signupForm.password}
                onChange={(e) =>
                  setSignupForm((p) => ({ ...p, password: e.target.value }))
                }
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                minLength={8}
                required
              />
              <button
                className="w-full rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
                disabled={registerMutation.isPending}
              >
                {registerMutation.isPending
                  ? "Creating account..."
                  : "Create account"}
              </button>
            </form>
          )}

          {authError && (
            <p className="mt-3 text-sm text-red-600">{authError}</p>
          )}
        </div>
      </main>
    );
  }

  const currency = groupDetails.data?.group.currency ?? "USD";

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_12%_18%,#f9e7a8_0%,transparent_38%),radial-gradient(circle_at_85%_4%,#f6b1a0_0%,transparent_32%),linear-gradient(140deg,#fdf7ed_0%,#f6f1e8_52%,#f2ebde_100%)] px-4 py-6 text-slate-900 md:px-8">
      <div className="mx-auto grid w-full max-w-7xl gap-4 lg:grid-cols-[340px_1fr]">
        <section className="rounded-3xl border border-slate-900/10 bg-white/80 p-5 shadow-[0_24px_80px_-40px_rgba(0,0,0,0.5)] backdrop-blur">
          <h1 className="font-heading text-4xl">Shared Wallet</h1>
          <p className="mt-1 text-sm text-slate-600">
            Signed in as {session.user.name ?? session.user.email}
          </p>
          <button
            onClick={() => signOut({ callbackUrl: "/" })}
            className="mt-3 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
          >
            Sign out
          </button>

          <h2 className="mt-6 text-sm font-semibold tracking-[0.2em] text-slate-500 uppercase">
            Your Private Groups
          </h2>
          <div className="mt-3 space-y-2">
            {groupsQuery.data?.map((group) => (
              <button
                key={group.id}
                onClick={() => setActiveGroupId(group.id)}
                className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                  activeGroupId === group.id
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white hover:border-slate-900/40"
                }`}
              >
                <div className="flex items-center justify-between">
                  <p className="font-semibold">{group.name}</p>
                  <span className="text-xs opacity-80">
                    {group.memberCount} members
                  </span>
                </div>
                <p className="mt-1 text-xs opacity-80">
                  Wallet {formatMoney(group.walletBalance, group.currency)}
                </p>
              </button>
            ))}
            {!groupsQuery.data?.length && (
              <p className="rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-600">
                You are not in any group yet.
              </p>
            )}
          </div>

          <h3 className="mt-6 text-sm font-semibold tracking-[0.2em] text-slate-500 uppercase">
            Create Private Group
          </h3>
          <form
            className="mt-2 space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              createGroup.mutate({
                ...createGroupForm,
                description: createGroupForm.description || undefined,
              });
            }}
          >
            <input
              placeholder="Group name"
              value={createGroupForm.name}
              onChange={(e) =>
                setCreateGroupForm((p) => ({ ...p, name: e.target.value }))
              }
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
              required
            />
            <input
              placeholder="Description"
              value={createGroupForm.description}
              onChange={(e) =>
                setCreateGroupForm((p) => ({
                  ...p,
                  description: e.target.value,
                }))
              }
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                value={createGroupForm.type}
                onChange={(e) =>
                  setCreateGroupForm((p) => ({
                    ...p,
                    type: e.target.value as (typeof groupTypes)[number],
                  }))
                }
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
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
                onChange={(e) =>
                  setCreateGroupForm((p) => ({
                    ...p,
                    currency: e.target.value.toUpperCase(),
                  }))
                }
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm uppercase"
              />
            </div>
            <button
              className="w-full rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
              disabled={createGroup.isPending}
            >
              {createGroup.isPending ? "Creating..." : "Create Group"}
            </button>
          </form>

          <h3 className="mt-6 text-sm font-semibold tracking-[0.2em] text-slate-500 uppercase">
            Join With Code
          </h3>
          <form
            className="mt-2 space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              joinByCode.mutate({ code: joinCode.toUpperCase() });
            }}
          >
            <input
              placeholder="6-character code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              maxLength={6}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm uppercase"
              required
            />
            <button className="w-full rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white">
              Join Group
            </button>
          </form>
        </section>

        <section className="rounded-3xl border border-slate-900/10 bg-white/80 p-5 shadow-[0_24px_80px_-40px_rgba(0,0,0,0.5)] backdrop-blur">
          {!activeGroupId && <p>Select or create a private group.</p>}

          {activeGroupId && groupDetails.data && dashboard.data && (
            <>
              <header className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold tracking-[0.2em] text-slate-500 uppercase">
                    Group Dashboard
                  </p>
                  <h2 className="font-heading text-4xl leading-tight">
                    {groupDetails.data.group.name}
                  </h2>
                  <p className="text-sm text-slate-600">
                    Private code:{" "}
                    <span className="font-semibold">
                      {groupDetails.data.group.joinCode ?? "N/A"}
                    </span>
                  </p>
                </div>
              </header>

              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <article className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs uppercase">Wallet</p>
                  <p className="mt-1 text-2xl font-semibold">
                    {formatMoney(
                      dashboard.data.balances.walletBalance,
                      currency,
                    )}
                  </p>
                </article>
                <article className="rounded-2xl border border-rose-200 bg-rose-50 p-3">
                  <p className="text-xs uppercase">Unsettled</p>
                  <p className="mt-1 text-2xl font-semibold">
                    {formatMoney(
                      dashboard.data.balances.unsettledAmount,
                      currency,
                    )}
                  </p>
                </article>
                <article className="rounded-2xl border border-sky-200 bg-sky-50 p-3">
                  <p className="text-xs uppercase">This Month</p>
                  <p className="mt-1 text-2xl font-semibold">
                    {formatMoney(
                      dashboard.data.monthlySummary.totalSpent,
                      currency,
                    )}
                  </p>
                </article>
              </div>

              <div className="mt-5 grid gap-3 lg:grid-cols-3">
                <form
                  className="rounded-2xl border border-slate-200 bg-white p-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!myMember.data) return;
                    const amount = Number(expenseForm.amount);
                    if (
                      !Number.isFinite(amount) ||
                      amount <= 0 ||
                      participants.length === 0
                    ) {
                      return;
                    }

                    addExpense.mutate({
                      groupId: activeGroupId,
                      title: expenseForm.title,
                      amount,
                      notes: expenseForm.notes || undefined,
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
                  <h3 className="font-semibold">Add Expense</h3>
                  <input
                    placeholder="Title"
                    value={expenseForm.title}
                    onChange={(e) =>
                      setExpenseForm((p) => ({ ...p, title: e.target.value }))
                    }
                    className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    required
                  />
                  <input
                    placeholder="Amount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={expenseForm.amount}
                    onChange={(e) =>
                      setExpenseForm((p) => ({ ...p, amount: e.target.value }))
                    }
                    className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    required
                  />
                  <select
                    value={expenseForm.paymentSource}
                    onChange={(e) =>
                      setExpenseForm((p) => ({
                        ...p,
                        paymentSource: e.target.value as "PERSONAL" | "WALLET",
                      }))
                    }
                    className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="PERSONAL">Paid Personally</option>
                    <option value="WALLET">Paid from Wallet</option>
                  </select>
                  <textarea
                    placeholder="Notes"
                    value={expenseForm.notes}
                    onChange={(e) =>
                      setExpenseForm((p) => ({ ...p, notes: e.target.value }))
                    }
                    className="mt-2 h-16 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                  <p className="mt-2 text-xs font-semibold text-slate-500 uppercase">
                    Participants
                  </p>
                  <div className="mt-1 max-h-32 space-y-1 overflow-y-auto">
                    {members.map((member) => (
                      <label
                        key={member.id}
                        className="flex items-center justify-between rounded-lg border border-slate-200 px-2 py-1 text-sm"
                      >
                        <span>{member.name}</span>
                        <input
                          type="checkbox"
                          checked={participants.includes(member.id)}
                          onChange={(e) => {
                            const checked = e.target.checked;
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
                  <button className="mt-2 w-full rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white">
                    Add Expense
                  </button>
                </form>

                <form
                  className="rounded-2xl border border-slate-200 bg-white p-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!myMember.data) return;
                    const amount = Number(fundAmount);
                    if (!Number.isFinite(amount) || amount <= 0) return;
                    addFund.mutate({
                      groupId: activeGroupId,
                      memberId: myMember.data.memberId,
                      amount,
                      note: fundNote || undefined,
                    });
                    setFundAmount("");
                    setFundNote("");
                  }}
                >
                  <h3 className="font-semibold">Add Fund</h3>
                  <input
                    placeholder="Amount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={fundAmount}
                    onChange={(e) => setFundAmount(e.target.value)}
                    className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    required
                  />
                  <input
                    placeholder="Note"
                    value={fundNote}
                    onChange={(e) => setFundNote(e.target.value)}
                    className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                  <button className="mt-2 w-full rounded-xl bg-amber-500 px-3 py-2 text-sm font-semibold text-slate-900">
                    Add to Wallet
                  </button>
                </form>

                <form
                  className="rounded-2xl border border-slate-200 bg-white p-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const amount = Number(settleForm.amount);
                    if (!Number.isFinite(amount) || amount <= 0) return;
                    addSettlement.mutate({
                      groupId: activeGroupId,
                      payerMemberId: settleForm.payerMemberId,
                      receiverMemberId: settleForm.receiverMemberId,
                      amount,
                      note: settleForm.note || undefined,
                    });
                  }}
                >
                  <h3 className="font-semibold">Settle Up</h3>
                  <select
                    value={settleForm.payerMemberId}
                    onChange={(e) =>
                      setSettleForm((p) => ({
                        ...p,
                        payerMemberId: e.target.value,
                      }))
                    }
                    className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  >
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        Payer: {member.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={settleForm.receiverMemberId}
                    onChange={(e) =>
                      setSettleForm((p) => ({
                        ...p,
                        receiverMemberId: e.target.value,
                      }))
                    }
                    className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
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
                    onChange={(e) =>
                      setSettleForm((p) => ({ ...p, amount: e.target.value }))
                    }
                    className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    required
                  />
                  <input
                    placeholder="Note"
                    value={settleForm.note}
                    onChange={(e) =>
                      setSettleForm((p) => ({ ...p, note: e.target.value }))
                    }
                    className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                  <button className="mt-2 w-full rounded-xl bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-900">
                    Record Settlement
                  </button>
                </form>
              </div>

              <div className="mt-5 grid gap-3 lg:grid-cols-2">
                <section className="rounded-2xl border border-slate-200 bg-white p-4">
                  <h3 className="font-semibold">Member Balances</h3>
                  <div className="mt-2 space-y-1 text-sm">
                    {dashboard.data.balances.memberBalances.map((member) => (
                      <div
                        key={member.memberId}
                        className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2"
                      >
                        <span>{member.name}</span>
                        <span className="font-medium">
                          {formatMoney(member.netBalance, currency)}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-4">
                  <h3 className="font-semibold">Activity</h3>
                  <div className="mt-2 max-h-52 space-y-2 overflow-y-auto text-sm">
                    {dashboard.data.recentActivity.map((entry) => (
                      <div
                        key={entry.id}
                        className="rounded-lg border border-slate-100 px-3 py-2"
                      >
                        <p>
                          <span className="font-medium">
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

              <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
                <h3 className="font-semibold">Suggested Settlements</h3>
                <div className="mt-2 space-y-2 text-sm">
                  {dashboard.data.suggestions.length === 0 && (
                    <p>No pending suggestions.</p>
                  )}
                  {dashboard.data.suggestions.map((suggestion, index) => (
                    <p
                      key={`${suggestion.fromMemberId}-${suggestion.toMemberId}-${index}`}
                    >
                      <span className="font-medium">
                        {memberMap.get(suggestion.fromMemberId)}
                      </span>{" "}
                      pays{" "}
                      <span className="font-medium">
                        {memberMap.get(suggestion.toMemberId)}
                      </span>{" "}
                      {formatMoney(suggestion.amount, currency)}
                    </p>
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
