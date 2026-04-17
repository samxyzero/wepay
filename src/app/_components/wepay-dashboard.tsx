"use client";

import { useEffect, useMemo, useState } from "react";

import { api } from "~/trpc/react";

type ReportRange = "week" | "month";
type Tab = "overview" | "wallet" | "reports" | "members";

const groupTypes = [
  "HOME",
  "TRIP",
  "FRIENDS",
  "OFFICE",
  "FAMILY",
  "CLUB",
  "OTHER",
] as const;

const categories = [
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

function formatMoney(value: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(date: string | Date) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
}

function niceLabel(text: string) {
  return text
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function WepayDashboard() {
  const utils = api.useUtils();

  const groupsQuery = api.group.list.useQuery();

  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [reportRange, setReportRange] = useState<ReportRange>("month");

  const [createGroupForm, setCreateGroupForm] = useState({
    name: "",
    description: "",
    type: "OTHER" as (typeof groupTypes)[number],
    currency: "USD",
    creatorName: "",
    creatorEmail: "",
    creatorPhone: "",
  });

  const groupDetails = api.group.details.useQuery(
    { groupId: activeGroupId ?? "" },
    { enabled: Boolean(activeGroupId) },
  );

  const dashboard = api.finance.dashboard.useQuery(
    { groupId: activeGroupId ?? "" },
    { enabled: Boolean(activeGroupId) },
  );

  const walletLedger = api.finance.walletLedger.useQuery(
    { groupId: activeGroupId ?? "", take: 120 },
    { enabled: Boolean(activeGroupId) },
  );

  const report = api.finance.report.useQuery(
    { groupId: activeGroupId ?? "", range: reportRange },
    { enabled: Boolean(activeGroupId) },
  );

  useEffect(() => {
    if (!activeGroupId && groupsQuery.data && groupsQuery.data.length > 0) {
      setActiveGroupId(groupsQuery.data[0]!.id);
    }
  }, [activeGroupId, groupsQuery.data]);

  const members = useMemo(
    () => groupDetails.data?.group.members ?? [],
    [groupDetails.data?.group.members],
  );
  const currency = groupDetails.data?.group.currency ?? "USD";

  const [addMemberForm, setAddMemberForm] = useState({
    name: "",
    email: "",
    phone: "",
    role: "MEMBER" as "ADMIN" | "MEMBER",
  });

  const [walletContributionForm, setWalletContributionForm] = useState({
    memberId: "",
    amount: "",
    note: "",
  });

  const [walletAdjustmentForm, setWalletAdjustmentForm] = useState({
    actorMemberId: "",
    amount: "",
    note: "",
  });

  const [settlementForm, setSettlementForm] = useState({
    payerMemberId: "",
    receiverMemberId: "",
    amount: "",
    note: "",
  });

  const [expenseForm, setExpenseForm] = useState({
    title: "",
    notes: "",
    amount: "",
    category: "OTHER" as (typeof categories)[number],
    splitType: "EQUAL" as "EQUAL" | "CUSTOM",
    paymentSource: "PERSONAL" as "PERSONAL" | "WALLET",
    paidByMemberId: "",
  });

  const [expenseParticipants, setExpenseParticipants] = useState<string[]>([]);
  const [customShares, setCustomShares] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!members.length) return;
    setExpenseParticipants((prev) =>
      prev.length > 0 ? prev : members.map((member) => member.id),
    );
    setExpenseForm((prev) => ({
      ...prev,
      paidByMemberId: prev.paidByMemberId || members[0]!.id,
    }));
    setWalletContributionForm((prev) => ({
      ...prev,
      memberId: prev.memberId || members[0]!.id,
    }));
    setWalletAdjustmentForm((prev) => ({
      ...prev,
      actorMemberId: prev.actorMemberId || members[0]!.id,
    }));
    setSettlementForm((prev) => ({
      ...prev,
      payerMemberId: prev.payerMemberId || members[0]!.id,
      receiverMemberId:
        prev.receiverMemberId || (members[1]?.id ?? members[0]!.id),
    }));
  }, [members]);

  const createGroup = api.group.create.useMutation({
    onSuccess: async (result) => {
      await utils.group.list.invalidate();
      setCreateGroupForm({
        name: "",
        description: "",
        type: "OTHER",
        currency: "USD",
        creatorName: "",
        creatorEmail: "",
        creatorPhone: "",
      });
      setActiveGroupId(result.groupId);
    },
  });

  const addMember = api.group.addMember.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.group.details.invalidate(),
        utils.finance.dashboard.invalidate(),
        utils.group.list.invalidate(),
      ]);
      setAddMemberForm({ name: "", email: "", phone: "", role: "MEMBER" });
    },
  });

  const addExpense = api.finance.addExpense.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.finance.dashboard.invalidate(),
        utils.finance.walletLedger.invalidate(),
        utils.finance.report.invalidate(),
      ]);
      setExpenseForm((prev) => ({
        ...prev,
        title: "",
        notes: "",
        amount: "",
      }));
      setCustomShares({});
    },
  });

  const addWalletContribution = api.finance.addWalletContribution.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.finance.dashboard.invalidate(),
        utils.finance.walletLedger.invalidate(),
        utils.finance.report.invalidate(),
      ]);
      setWalletContributionForm((prev) => ({ ...prev, amount: "", note: "" }));
    },
  });

  const addWalletAdjustment = api.finance.addWalletAdjustment.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.finance.dashboard.invalidate(),
        utils.finance.walletLedger.invalidate(),
        utils.finance.report.invalidate(),
      ]);
      setWalletAdjustmentForm((prev) => ({ ...prev, amount: "", note: "" }));
    },
  });

  const addSettlement = api.finance.addSettlement.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.finance.dashboard.invalidate(),
        utils.finance.report.invalidate(),
      ]);
      setSettlementForm((prev) => ({ ...prev, amount: "", note: "" }));
    },
  });

  const memberNames = useMemo(() => {
    return new Map(members.map((m) => [m.id, m.name]));
  }, [members]);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_12%_18%,#f9e7a8_0%,transparent_38%),radial-gradient(circle_at_85%_4%,#f6b1a0_0%,transparent_32%),linear-gradient(140deg,#fdf7ed_0%,#f6f1e8_52%,#f2ebde_100%)] px-4 py-6 text-slate-900 md:px-8">
      <div className="mx-auto grid w-full max-w-7xl gap-4 lg:grid-cols-[340px_1fr]">
        <section className="rounded-3xl border border-slate-900/10 bg-white/80 p-5 shadow-[0_24px_80px_-40px_rgba(0,0,0,0.5)] backdrop-blur">
          <h1 className="font-heading text-4xl tracking-tight">
            Shared Wallet
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Create groups for flatmates, trips, clubs, or friends and run every
            shared-money activity from one ledger.
          </p>

          <h2 className="mt-6 text-sm font-semibold tracking-[0.2em] text-slate-500 uppercase">
            Your Groups
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
                <div className="flex items-center justify-between gap-2">
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
                No groups yet. Create your first one below.
              </p>
            )}
          </div>

          <h2 className="mt-6 text-sm font-semibold tracking-[0.2em] text-slate-500 uppercase">
            Create Group
          </h2>
          <form
            className="mt-3 space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              createGroup.mutate({
                ...createGroupForm,
                description: createGroupForm.description || undefined,
                creatorEmail: createGroupForm.creatorEmail || undefined,
                creatorPhone: createGroupForm.creatorPhone || undefined,
              });
            }}
          >
            <input
              value={createGroupForm.name}
              onChange={(event) =>
                setCreateGroupForm((prev) => ({
                  ...prev,
                  name: event.target.value,
                }))
              }
              placeholder="Group name"
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
              required
            />
            <input
              value={createGroupForm.description}
              onChange={(event) =>
                setCreateGroupForm((prev) => ({
                  ...prev,
                  description: event.target.value,
                }))
              }
              placeholder="Description (optional)"
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                value={createGroupForm.type}
                onChange={(event) =>
                  setCreateGroupForm((prev) => ({
                    ...prev,
                    type: event.target.value as (typeof groupTypes)[number],
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
                value={createGroupForm.currency}
                onChange={(event) =>
                  setCreateGroupForm((prev) => ({
                    ...prev,
                    currency: event.target.value.toUpperCase(),
                  }))
                }
                placeholder="Currency"
                maxLength={3}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm uppercase"
                required
              />
            </div>
            <input
              value={createGroupForm.creatorName}
              onChange={(event) =>
                setCreateGroupForm((prev) => ({
                  ...prev,
                  creatorName: event.target.value,
                }))
              }
              placeholder="Your name"
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
              required
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                value={createGroupForm.creatorEmail}
                onChange={(event) =>
                  setCreateGroupForm((prev) => ({
                    ...prev,
                    creatorEmail: event.target.value,
                  }))
                }
                placeholder="Email"
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
              />
              <input
                value={createGroupForm.creatorPhone}
                onChange={(event) =>
                  setCreateGroupForm((prev) => ({
                    ...prev,
                    creatorPhone: event.target.value,
                  }))
                }
                placeholder="Phone"
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={createGroup.isPending}
              className="w-full rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50"
            >
              {createGroup.isPending ? "Creating..." : "Create Group"}
            </button>
          </form>
        </section>

        <section className="rounded-3xl border border-slate-900/10 bg-white/80 p-5 shadow-[0_24px_80px_-40px_rgba(0,0,0,0.5)] backdrop-blur">
          {!activeGroupId && <p>Select or create a group to start tracking.</p>}
          {activeGroupId && (
            <>
              <header className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold tracking-[0.2em] text-slate-500 uppercase">
                    Group Dashboard
                  </p>
                  <h2 className="font-heading text-4xl leading-tight">
                    {groupDetails.data?.group.name ?? "Loading..."}
                  </h2>
                  <p className="text-sm text-slate-600">
                    {groupDetails.data?.group.description ??
                      "Track spending, wallet flow, and settlements clearly."}
                  </p>
                </div>
                <div className="flex gap-2 rounded-full bg-slate-100 p-1">
                  {(["overview", "wallet", "reports", "members"] as Tab[]).map(
                    (tab) => (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                          activeTab === tab
                            ? "bg-slate-900 text-white"
                            : "text-slate-600 hover:text-slate-900"
                        }`}
                      >
                        {niceLabel(tab)}
                      </button>
                    ),
                  )}
                </div>
              </header>

              <div className="mt-5 grid gap-3 md:grid-cols-4">
                <article className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs tracking-[0.16em] text-amber-700 uppercase">
                    Wallet Balance
                  </p>
                  <p className="mt-1 text-2xl font-semibold">
                    {formatMoney(
                      dashboard.data?.balances.walletBalance ?? 0,
                      currency,
                    )}
                  </p>
                </article>
                <article className="rounded-2xl border border-rose-200 bg-rose-50 p-3">
                  <p className="text-xs tracking-[0.16em] text-rose-700 uppercase">
                    Unsettled
                  </p>
                  <p className="mt-1 text-2xl font-semibold">
                    {formatMoney(
                      dashboard.data?.balances.unsettledAmount ?? 0,
                      currency,
                    )}
                  </p>
                </article>
                <article className="rounded-2xl border border-sky-200 bg-sky-50 p-3">
                  <p className="text-xs tracking-[0.16em] text-sky-700 uppercase">
                    This Week
                  </p>
                  <p className="mt-1 text-2xl font-semibold">
                    {formatMoney(
                      dashboard.data?.weeklySummary.totalSpent ?? 0,
                      currency,
                    )}
                  </p>
                </article>
                <article className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
                  <p className="text-xs tracking-[0.16em] text-emerald-700 uppercase">
                    This Month
                  </p>
                  <p className="mt-1 text-2xl font-semibold">
                    {formatMoney(
                      dashboard.data?.monthlySummary.totalSpent ?? 0,
                      currency,
                    )}
                  </p>
                </article>
              </div>

              <div className="mt-5 grid gap-3 lg:grid-cols-2">
                <form
                  className="rounded-2xl border border-slate-200 bg-white p-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!activeGroupId) return;

                    const amount = Number(expenseForm.amount);
                    if (!Number.isFinite(amount) || amount <= 0) return;

                    addExpense.mutate({
                      groupId: activeGroupId,
                      title: expenseForm.title,
                      notes: expenseForm.notes || undefined,
                      amount,
                      category: expenseForm.category,
                      splitType: expenseForm.splitType,
                      paymentSource: expenseForm.paymentSource,
                      paidByMemberId:
                        expenseForm.paymentSource === "PERSONAL"
                          ? expenseForm.paidByMemberId
                          : expenseForm.paidByMemberId || undefined,
                      participantIds:
                        expenseForm.splitType === "EQUAL"
                          ? expenseParticipants
                          : undefined,
                      customShares:
                        expenseForm.splitType === "CUSTOM"
                          ? expenseParticipants.map((memberId) => ({
                              memberId,
                              share: Number(customShares[memberId] ?? "0"),
                            }))
                          : undefined,
                    });
                  }}
                >
                  <h3 className="font-semibold">Add Expense</h3>
                  <div className="mt-2 space-y-2">
                    <input
                      value={expenseForm.title}
                      onChange={(event) =>
                        setExpenseForm((prev) => ({
                          ...prev,
                          title: event.target.value,
                        }))
                      }
                      placeholder="Title"
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                      required
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        value={expenseForm.amount}
                        onChange={(event) =>
                          setExpenseForm((prev) => ({
                            ...prev,
                            amount: event.target.value,
                          }))
                        }
                        placeholder="Amount"
                        type="number"
                        step="0.01"
                        min="0"
                        className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        required
                      />
                      <select
                        value={expenseForm.category}
                        onChange={(event) =>
                          setExpenseForm((prev) => ({
                            ...prev,
                            category: event.target
                              .value as (typeof categories)[number],
                          }))
                        }
                        className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                      >
                        {categories.map((category) => (
                          <option key={category} value={category}>
                            {niceLabel(category)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
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
                        className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                      >
                        <option value="PERSONAL">Personal Payment</option>
                        <option value="WALLET">Shared Wallet</option>
                      </select>
                      <select
                        value={expenseForm.splitType}
                        onChange={(event) =>
                          setExpenseForm((prev) => ({
                            ...prev,
                            splitType: event.target.value as "EQUAL" | "CUSTOM",
                          }))
                        }
                        className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                      >
                        <option value="EQUAL">Equal Split</option>
                        <option value="CUSTOM">Custom Split</option>
                      </select>
                    </div>
                    <select
                      value={expenseForm.paidByMemberId}
                      onChange={(event) =>
                        setExpenseForm((prev) => ({
                          ...prev,
                          paidByMemberId: event.target.value,
                        }))
                      }
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    >
                      {members.map((member) => (
                        <option key={member.id} value={member.id}>
                          Paid by: {member.name}
                        </option>
                      ))}
                    </select>

                    <p className="text-xs font-semibold tracking-[0.15em] text-slate-500 uppercase">
                      Participants
                    </p>
                    <div className="grid gap-1">
                      {members.map((member) => {
                        const checked = expenseParticipants.includes(member.id);
                        return (
                          <label
                            key={member.id}
                            className="flex items-center justify-between rounded-lg border border-slate-200 px-2 py-1 text-sm"
                          >
                            <span>{member.name}</span>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => {
                                const shouldAdd = event.target.checked;
                                setExpenseParticipants((prev) =>
                                  shouldAdd
                                    ? [...prev, member.id]
                                    : prev.filter((id) => id !== member.id),
                                );
                              }}
                            />
                          </label>
                        );
                      })}
                    </div>

                    {expenseForm.splitType === "CUSTOM" && (
                      <div className="space-y-1 rounded-xl bg-slate-50 p-2">
                        {expenseParticipants.map((memberId) => (
                          <div
                            key={memberId}
                            className="flex items-center gap-2 text-sm"
                          >
                            <span className="w-28 shrink-0">
                              {memberNames.get(memberId)}
                            </span>
                            <input
                              value={customShares[memberId] ?? ""}
                              onChange={(event) =>
                                setCustomShares((prev) => ({
                                  ...prev,
                                  [memberId]: event.target.value,
                                }))
                              }
                              placeholder="Share"
                              type="number"
                              min="0"
                              step="0.01"
                              className="w-full rounded-lg border border-slate-300 px-2 py-1"
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    <textarea
                      value={expenseForm.notes}
                      onChange={(event) =>
                        setExpenseForm((prev) => ({
                          ...prev,
                          notes: event.target.value,
                        }))
                      }
                      placeholder="Notes"
                      className="h-16 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    />
                    <button
                      type="submit"
                      disabled={addExpense.isPending}
                      className="w-full rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
                    >
                      {addExpense.isPending ? "Saving..." : "Save Expense"}
                    </button>
                  </div>
                </form>

                <div className="space-y-3">
                  <form
                    className="rounded-2xl border border-slate-200 bg-white p-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!activeGroupId) return;
                      const amount = Number(walletContributionForm.amount);
                      if (!Number.isFinite(amount) || amount <= 0) return;
                      addWalletContribution.mutate({
                        groupId: activeGroupId,
                        memberId: walletContributionForm.memberId,
                        amount,
                        note: walletContributionForm.note || undefined,
                      });
                    }}
                  >
                    <h3 className="font-semibold">Add Fund</h3>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <select
                        value={walletContributionForm.memberId}
                        onChange={(event) =>
                          setWalletContributionForm((prev) => ({
                            ...prev,
                            memberId: event.target.value,
                          }))
                        }
                        className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                      >
                        {members.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.name}
                          </option>
                        ))}
                      </select>
                      <input
                        value={walletContributionForm.amount}
                        onChange={(event) =>
                          setWalletContributionForm((prev) => ({
                            ...prev,
                            amount: event.target.value,
                          }))
                        }
                        placeholder="Amount"
                        type="number"
                        min="0"
                        step="0.01"
                        className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        required
                      />
                    </div>
                    <input
                      value={walletContributionForm.note}
                      onChange={(event) =>
                        setWalletContributionForm((prev) => ({
                          ...prev,
                          note: event.target.value,
                        }))
                      }
                      placeholder="Note"
                      className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    />
                    <button
                      type="submit"
                      className="mt-2 w-full rounded-xl bg-amber-500 px-3 py-2 text-sm font-semibold text-slate-900"
                    >
                      Add to Wallet
                    </button>
                  </form>

                  <form
                    className="rounded-2xl border border-slate-200 bg-white p-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!activeGroupId) return;
                      const amount = Number(walletAdjustmentForm.amount);
                      if (!Number.isFinite(amount)) return;
                      addWalletAdjustment.mutate({
                        groupId: activeGroupId,
                        actorMemberId:
                          walletAdjustmentForm.actorMemberId || undefined,
                        amount,
                        note: walletAdjustmentForm.note,
                      });
                    }}
                  >
                    <h3 className="font-semibold">Wallet Adjustment</h3>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <select
                        value={walletAdjustmentForm.actorMemberId}
                        onChange={(event) =>
                          setWalletAdjustmentForm((prev) => ({
                            ...prev,
                            actorMemberId: event.target.value,
                          }))
                        }
                        className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                      >
                        {members.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.name}
                          </option>
                        ))}
                      </select>
                      <input
                        value={walletAdjustmentForm.amount}
                        onChange={(event) =>
                          setWalletAdjustmentForm((prev) => ({
                            ...prev,
                            amount: event.target.value,
                          }))
                        }
                        placeholder="+ / - amount"
                        type="number"
                        step="0.01"
                        className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        required
                      />
                    </div>
                    <input
                      value={walletAdjustmentForm.note}
                      onChange={(event) =>
                        setWalletAdjustmentForm((prev) => ({
                          ...prev,
                          note: event.target.value,
                        }))
                      }
                      placeholder="Reason"
                      className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                      required
                    />
                    <button
                      type="submit"
                      className="mt-2 w-full rounded-xl bg-slate-200 px-3 py-2 text-sm font-semibold text-slate-900"
                    >
                      Save Adjustment
                    </button>
                  </form>

                  <form
                    className="rounded-2xl border border-slate-200 bg-white p-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!activeGroupId) return;
                      const amount = Number(settlementForm.amount);
                      if (!Number.isFinite(amount) || amount <= 0) return;
                      addSettlement.mutate({
                        groupId: activeGroupId,
                        payerMemberId: settlementForm.payerMemberId,
                        receiverMemberId: settlementForm.receiverMemberId,
                        amount,
                        note: settlementForm.note || undefined,
                      });
                    }}
                  >
                    <h3 className="font-semibold">Settle Up</h3>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <select
                        value={settlementForm.payerMemberId}
                        onChange={(event) =>
                          setSettlementForm((prev) => ({
                            ...prev,
                            payerMemberId: event.target.value,
                          }))
                        }
                        className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                      >
                        {members.map((member) => (
                          <option key={member.id} value={member.id}>
                            Payer: {member.name}
                          </option>
                        ))}
                      </select>
                      <select
                        value={settlementForm.receiverMemberId}
                        onChange={(event) =>
                          setSettlementForm((prev) => ({
                            ...prev,
                            receiverMemberId: event.target.value,
                          }))
                        }
                        className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                      >
                        {members.map((member) => (
                          <option key={member.id} value={member.id}>
                            Receiver: {member.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <input
                      value={settlementForm.amount}
                      onChange={(event) =>
                        setSettlementForm((prev) => ({
                          ...prev,
                          amount: event.target.value,
                        }))
                      }
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Amount"
                      className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                      required
                    />
                    <input
                      value={settlementForm.note}
                      onChange={(event) =>
                        setSettlementForm((prev) => ({
                          ...prev,
                          note: event.target.value,
                        }))
                      }
                      placeholder="Note"
                      className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    />
                    <button
                      type="submit"
                      className="mt-2 w-full rounded-xl bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-900"
                    >
                      Record Settlement
                    </button>
                  </form>
                </div>
              </div>

              {activeTab === "overview" && (
                <div className="mt-5 grid gap-3 lg:grid-cols-2">
                  <section className="rounded-2xl border border-slate-200 bg-white p-4">
                    <h3 className="font-semibold">Suggested Settlements</h3>
                    <div className="mt-2 space-y-2 text-sm">
                      {dashboard.data?.suggestions.length ? (
                        dashboard.data.suggestions.map((item, index) => (
                          <div
                            key={`${item.fromMemberId}-${item.toMemberId}-${index}`}
                            className="rounded-lg bg-slate-50 px-3 py-2"
                          >
                            <span className="font-medium">
                              {memberNames.get(item.fromMemberId)}
                            </span>{" "}
                            pays{" "}
                            <span className="font-medium">
                              {memberNames.get(item.toMemberId)}
                            </span>{" "}
                            {formatMoney(item.amount, currency)}
                          </div>
                        ))
                      ) : (
                        <p className="text-slate-600">
                          No pending suggestions right now.
                        </p>
                      )}
                    </div>
                  </section>

                  <section className="rounded-2xl border border-slate-200 bg-white p-4">
                    <h3 className="font-semibold">Recent Activity</h3>
                    <div className="mt-2 max-h-72 space-y-2 overflow-y-auto pr-1 text-sm">
                      {dashboard.data?.recentActivity.map((entry) => (
                        <div
                          key={entry.id}
                          className="rounded-lg border border-slate-100 px-3 py-2"
                        >
                          <p>
                            <span className="font-medium">
                              {entry.actorMember?.name ?? "System"}
                            </span>{" "}
                            {entry.note ?? niceLabel(entry.type)}
                            {entry.amount && (
                              <>
                                {" "}
                                for{" "}
                                {formatMoney(entry.amount.toNumber(), currency)}
                              </>
                            )}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {formatDate(entry.createdAt)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              )}

              {activeTab === "wallet" && (
                <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
                  <h3 className="font-semibold">Wallet Ledger</h3>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-180 text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500">
                          <th className="py-2">Date</th>
                          <th className="py-2">Type</th>
                          <th className="py-2">Actor</th>
                          <th className="py-2">Amount</th>
                          <th className="py-2">Balance After</th>
                          <th className="py-2">Note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {walletLedger.data?.map((entry) => (
                          <tr
                            key={entry.id}
                            className="border-b border-slate-100"
                          >
                            <td className="py-2">{formatDate(entry.date)}</td>
                            <td className="py-2">{niceLabel(entry.type)}</td>
                            <td className="py-2">
                              {entry.member?.name ?? "System"}
                            </td>
                            <td className="py-2">
                              {formatMoney(entry.amount.toNumber(), currency)}
                            </td>
                            <td className="py-2">
                              {formatMoney(entry.balanceAfter, currency)}
                            </td>
                            <td className="py-2 text-slate-600">
                              {entry.note ?? "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {activeTab === "reports" && (
                <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="font-semibold">Weekly & Monthly Reports</h3>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setReportRange("week")}
                        className={`rounded-full px-3 py-1 text-sm ${
                          reportRange === "week"
                            ? "bg-slate-900 text-white"
                            : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        Week
                      </button>
                      <button
                        onClick={() => setReportRange("month")}
                        className={`rounded-full px-3 py-1 text-sm ${
                          reportRange === "month"
                            ? "bg-slate-900 text-white"
                            : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        Month
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-4">
                    <article className="rounded-xl bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">Total Spent</p>
                      <p className="mt-1 text-xl font-semibold">
                        {formatMoney(
                          report.data?.currentSummary.totalSpent ?? 0,
                          currency,
                        )}
                      </p>
                    </article>
                    <article className="rounded-xl bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">Wallet Top-Ups</p>
                      <p className="mt-1 text-xl font-semibold">
                        {formatMoney(
                          report.data?.currentSummary.walletTopUps ?? 0,
                          currency,
                        )}
                      </p>
                    </article>
                    <article className="rounded-xl bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">Wallet Used</p>
                      <p className="mt-1 text-xl font-semibold">
                        {formatMoney(
                          report.data?.currentSummary.walletUsed ?? 0,
                          currency,
                        )}
                      </p>
                    </article>
                    <article className="rounded-xl bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">
                        Spend vs Previous
                      </p>
                      <p className="mt-1 text-xl font-semibold">
                        {report.data?.spendDeltaPct == null
                          ? "N/A"
                          : `${report.data.spendDeltaPct > 0 ? "+" : ""}${report.data.spendDeltaPct}%`}
                      </p>
                    </article>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <article className="rounded-xl border border-slate-200 p-3">
                      <h4 className="font-medium">Highlights</h4>
                      <ul className="mt-2 space-y-1 text-sm text-slate-700">
                        <li>
                          Average per day:{" "}
                          {formatMoney(
                            report.data?.currentSummary.averagePerDay ?? 0,
                            currency,
                          )}
                        </li>
                        <li>
                          Highest single expense:{" "}
                          {formatMoney(
                            report.data?.currentSummary.highestSingleExpense ??
                              0,
                            currency,
                          )}
                        </li>
                        <li>
                          Biggest category:{" "}
                          {report.data?.currentSummary.highestCategory?.label ??
                            "-"}
                        </li>
                        <li>
                          Top spender:{" "}
                          {report.data?.currentSummary.topSpender?.name ?? "-"}
                        </li>
                      </ul>
                    </article>
                    <article className="rounded-xl border border-slate-200 p-3">
                      <h4 className="font-medium">Category Breakdown</h4>
                      <div className="mt-2 space-y-1 text-sm">
                        {report.data?.currentSummary.categoryBreakdown.map(
                          (item) => (
                            <div
                              key={item.key}
                              className="flex items-center justify-between rounded-lg bg-slate-50 px-2 py-1"
                            >
                              <span>{item.label}</span>
                              <span>{formatMoney(item.amount, currency)}</span>
                            </div>
                          ),
                        )}
                      </div>
                    </article>
                  </div>
                </section>
              )}

              {activeTab === "members" && (
                <section className="mt-5 grid gap-3 lg:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <h3 className="font-semibold">Members</h3>
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full min-w-170 text-left text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-500">
                            <th className="py-2">Name</th>
                            <th className="py-2">Role</th>
                            <th className="py-2">Paid</th>
                            <th className="py-2">Contributed</th>
                            <th className="py-2">Net</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dashboard.data?.balances.memberBalances.map(
                            (member) => (
                              <tr
                                key={member.memberId}
                                className="border-b border-slate-100"
                              >
                                <td className="py-2">{member.name}</td>
                                <td className="py-2">
                                  {niceLabel(member.role)}
                                </td>
                                <td className="py-2">
                                  {formatMoney(member.personalPaid, currency)}
                                </td>
                                <td className="py-2">
                                  {formatMoney(
                                    member.walletContributed,
                                    currency,
                                  )}
                                </td>
                                <td className="py-2 font-medium">
                                  {formatMoney(member.netBalance, currency)}
                                </td>
                              </tr>
                            ),
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <form
                    className="rounded-2xl border border-slate-200 bg-white p-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!activeGroupId) return;
                      addMember.mutate({
                        groupId: activeGroupId,
                        ...addMemberForm,
                        email: addMemberForm.email || undefined,
                        phone: addMemberForm.phone || undefined,
                      });
                    }}
                  >
                    <h3 className="font-semibold">Add Member</h3>
                    <div className="mt-2 space-y-2">
                      <input
                        value={addMemberForm.name}
                        onChange={(event) =>
                          setAddMemberForm((prev) => ({
                            ...prev,
                            name: event.target.value,
                          }))
                        }
                        placeholder="Name"
                        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        required
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          value={addMemberForm.email}
                          onChange={(event) =>
                            setAddMemberForm((prev) => ({
                              ...prev,
                              email: event.target.value,
                            }))
                          }
                          placeholder="Email"
                          className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        />
                        <input
                          value={addMemberForm.phone}
                          onChange={(event) =>
                            setAddMemberForm((prev) => ({
                              ...prev,
                              phone: event.target.value,
                            }))
                          }
                          placeholder="Phone"
                          className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>
                      <select
                        value={addMemberForm.role}
                        onChange={(event) =>
                          setAddMemberForm((prev) => ({
                            ...prev,
                            role: event.target.value as "ADMIN" | "MEMBER",
                          }))
                        }
                        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                      >
                        <option value="MEMBER">Member</option>
                        <option value="ADMIN">Admin</option>
                      </select>
                      <button
                        type="submit"
                        className="w-full rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
                      >
                        Add Member
                      </button>
                    </div>
                  </form>
                </section>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
