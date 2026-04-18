import { type PrismaClient } from "../../../generated/prisma";

const round2 = (value: number) => Math.round(value * 100) / 100;
const toNumber = (value: { toNumber(): number } | number) =>
  typeof value === "number" ? value : value.toNumber();

type WalletSourceState = {
  system: number;
  members: Map<string, number>;
};

type WalletConsumption = {
  memberAllocations: Map<string, number>;
  systemAmount: number;
};

export type MemberBalance = {
  memberId: string;
  name: string;
  role: "ADMIN" | "MEMBER";
  personalPaid: number;
  walletContributed: number;
  walletExpensesFunded: number;
  settlementsPaid: number;
  settlementsReceived: number;
  netBalance: number;
};

export type SuggestedSettlement = {
  fromMemberId: string;
  toMemberId: string;
  amount: number;
};

export const CATEGORY_LABELS: Record<string, string> = {
  GROCERIES: "Groceries",
  RENT: "Rent",
  ELECTRICITY: "Electricity",
  INTERNET: "Internet",
  CLEANING: "Cleaning",
  TRANSPORT: "Transport",
  DINING: "Dining",
  TRIP: "Trip",
  MAINTENANCE: "Maintenance",
  OTHER: "Other",
};

export const WALLET_ENTRY_LABELS: Record<string, string> = {
  CONTRIBUTION: "Wallet Top-up",
  EXPENSE: "Wallet Expense",
  ADJUSTMENT: "Wallet Adjustment",
  WITHDRAWAL: "Wallet Withdrawal",
};

export const LEDGER_ENTRY_LABELS: Record<string, string> = {
  EXPENSE_PERSONAL: "Personal Expense",
  EXPENSE_WALLET: "Wallet Expense",
  WALLET_CONTRIBUTION: "Wallet Top-up",
  SETTLEMENT_PAYMENT: "Settlement",
  WALLET_ADJUSTMENT: "Wallet Adjustment",
  EXPENSE_EDIT_LOG: "Expense Update",
  EXPENSE_DELETE_LOG: "Expense Removal",
};

function addWalletSource(
  state: WalletSourceState,
  amount: number,
  memberId?: string | null,
) {
  if (amount <= 0) return;

  if (memberId) {
    state.members.set(
      memberId,
      round2((state.members.get(memberId) ?? 0) + amount),
    );
    return;
  }

  state.system = round2(state.system + amount);
}

function consumeWalletSources(
  state: WalletSourceState,
  amount: number,
  preferredMemberId?: string | null,
): WalletConsumption {
  const memberAllocations = new Map<string, number>();
  let systemAmount = 0;
  let remaining = round2(amount);

  if (remaining <= 0) {
    return { memberAllocations, systemAmount };
  }

  if (preferredMemberId) {
    const preferredAvailable = round2(
      Math.max(0, state.members.get(preferredMemberId) ?? 0),
    );
    const preferredPortion = round2(Math.min(preferredAvailable, remaining));

    if (preferredPortion > 0) {
      state.members.set(
        preferredMemberId,
        round2(preferredAvailable - preferredPortion),
      );
      memberAllocations.set(preferredMemberId, preferredPortion);
      remaining = round2(remaining - preferredPortion);
    }
  }

  if (remaining <= 0) {
    return { memberAllocations, systemAmount };
  }

  const sources: Array<
    | { kind: "system"; available: number }
    | { kind: "member"; memberId: string; available: number }
  > = [];

  if (state.system > 0.009) {
    sources.push({ kind: "system", available: round2(state.system) });
  }

  for (const [memberId, available] of state.members.entries()) {
    if (memberId === preferredMemberId || available <= 0.009) continue;
    sources.push({
      kind: "member",
      memberId,
      available: round2(available),
    });
  }

  const totalAvailable = round2(
    sources.reduce((sum, source) => sum + source.available, 0),
  );

  if (totalAvailable <= 0) {
    return {
      memberAllocations,
      systemAmount: round2(remaining),
    };
  }

  const allocatable = round2(Math.min(totalAvailable, remaining));
  let remainingToAllocate = allocatable;
  let remainingPool = totalAvailable;

  sources.forEach((source, index) => {
    const isLast = index === sources.length - 1;
    const portion = isLast
      ? round2(remainingToAllocate)
      : round2((remainingToAllocate * source.available) / remainingPool);
    const safePortion = round2(
      Math.min(source.available, portion, remainingToAllocate),
    );

    remainingToAllocate = round2(remainingToAllocate - safePortion);
    remainingPool = round2(remainingPool - source.available);

    if (safePortion <= 0) return;

    if (source.kind === "system") {
      state.system = round2(state.system - safePortion);
      systemAmount = round2(systemAmount + safePortion);
      return;
    }

    state.members.set(
      source.memberId,
      round2((state.members.get(source.memberId) ?? 0) - safePortion),
    );
    memberAllocations.set(
      source.memberId,
      round2((memberAllocations.get(source.memberId) ?? 0) + safePortion),
    );
  });

  const unattributedAmount = round2(remaining - allocatable);

  return {
    memberAllocations,
    systemAmount: round2(systemAmount + unattributedAmount),
  };
}

function allocateParticipantAmount<
  T extends { memberId: string; share: { toNumber(): number } | number },
>(participants: T[], totalAmount: number) {
  if (participants.length === 0 || totalAmount <= 0) return [];

  const totalShares = round2(
    participants.reduce(
      (sum, participant) => sum + toNumber(participant.share),
      0,
    ),
  );

  if (totalShares <= 0) return [];

  let remainingAmount = round2(totalAmount);
  let remainingShares = totalShares;

  return participants.map((participant, index) => {
    const share = round2(toNumber(participant.share));
    const isLast = index === participants.length - 1;
    const allocated = isLast
      ? round2(remainingAmount)
      : round2((remainingAmount * share) / remainingShares);
    const safeAllocated = round2(Math.min(remainingAmount, allocated));

    remainingAmount = round2(remainingAmount - safeAllocated);
    remainingShares = round2(remainingShares - share);

    return {
      memberId: participant.memberId,
      amount: safeAllocated,
    };
  });
}

export function getDateRange(
  kind: "week" | "month" | "custom",
  customStart?: Date,
  customEnd?: Date,
) {
  if (kind === "custom" && customStart && customEnd) {
    return { start: customStart, end: customEnd };
  }

  const now = new Date();
  if (kind === "week") {
    const day = now.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const start = new Date(now);
    start.setDate(now.getDate() + mondayOffset);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    return { start, end };
  }

  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start, end };
}

export function getPreviousRange(start: Date, end: Date) {
  const spanMs = end.getTime() - start.getTime();
  return {
    start: new Date(start.getTime() - spanMs),
    end: new Date(end.getTime() - spanMs),
  };
}

export function getWalletEntrySignedAmount(type: string, amount: number) {
  if (type === "CONTRIBUTION") return round2(amount);
  if (type === "ADJUSTMENT") return round2(amount);
  return round2(-amount);
}

export async function computeGroupBalances(db: PrismaClient, groupId: string) {
  const [members, expenses, settlements, walletEntries] = await Promise.all([
    db.groupMember.findMany({ where: { groupId } }),
    db.expense.findMany({
      where: { groupId },
      include: { participants: true },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    }),
    db.settlement.findMany({
      where: { groupId },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    }),
    db.walletEntry.findMany({
      where: { groupId },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  const balances = new Map<string, number>();
  const personalPaid = new Map<string, number>();
  const walletContributed = new Map<string, number>();
  const walletExpensesFunded = new Map<string, number>();
  const settlementsPaid = new Map<string, number>();
  const settlementsReceived = new Map<string, number>();
  const walletSources: WalletSourceState = {
    system: 0,
    members: new Map<string, number>(),
  };

  for (const member of members) {
    balances.set(member.id, 0);
    personalPaid.set(member.id, 0);
    walletContributed.set(member.id, 0);
    walletExpensesFunded.set(member.id, 0);
    settlementsPaid.set(member.id, 0);
    settlementsReceived.set(member.id, 0);
    walletSources.members.set(member.id, 0);
  }

  const expenseById = new Map(expenses.map((expense) => [expense.id, expense]));

  for (const expense of expenses) {
    if (expense.paymentSource !== "PERSONAL" || !expense.paidByMemberId) {
      continue;
    }

    const amount = toNumber(expense.amount);
    balances.set(
      expense.paidByMemberId,
      round2((balances.get(expense.paidByMemberId) ?? 0) + amount),
    );
    personalPaid.set(
      expense.paidByMemberId,
      round2((personalPaid.get(expense.paidByMemberId) ?? 0) + amount),
    );

    for (const split of expense.participants) {
      const share = toNumber(split.share);
      balances.set(
        split.memberId,
        round2((balances.get(split.memberId) ?? 0) - share),
      );
    }
  }

  let walletBalance = 0;

  for (const entry of walletEntries) {
    const amount = toNumber(entry.amount);

    if (entry.type === "CONTRIBUTION") {
      walletBalance = round2(walletBalance + amount);
      addWalletSource(walletSources, amount, entry.memberId);

      if (entry.memberId) {
        walletContributed.set(
          entry.memberId,
          round2((walletContributed.get(entry.memberId) ?? 0) + amount),
        );
      }

      continue;
    }

    if (entry.type === "ADJUSTMENT") {
      walletBalance = round2(walletBalance + amount);

      if (amount >= 0) {
        addWalletSource(walletSources, amount, entry.memberId);
      } else {
        consumeWalletSources(walletSources, Math.abs(amount), entry.memberId);
      }

      continue;
    }

    if (entry.type === "WITHDRAWAL") {
      walletBalance = round2(walletBalance - amount);
      consumeWalletSources(walletSources, amount, entry.memberId);
      continue;
    }

    if (entry.type !== "EXPENSE") continue;

    walletBalance = round2(walletBalance - amount);

    const { memberAllocations } = consumeWalletSources(walletSources, amount);
    const fundedByMembers = round2(
      [...memberAllocations.values()].reduce((sum, value) => sum + value, 0),
    );

    for (const [memberId, fundedAmount] of memberAllocations.entries()) {
      balances.set(
        memberId,
        round2((balances.get(memberId) ?? 0) + fundedAmount),
      );
      walletExpensesFunded.set(
        memberId,
        round2((walletExpensesFunded.get(memberId) ?? 0) + fundedAmount),
      );
    }

    const expense = entry.expenseId ? expenseById.get(entry.expenseId) : null;
    if (!expense || fundedByMembers <= 0) continue;

    for (const participant of allocateParticipantAmount(
      expense.participants,
      fundedByMembers,
    )) {
      balances.set(
        participant.memberId,
        round2((balances.get(participant.memberId) ?? 0) - participant.amount),
      );
    }
  }

  for (const settlement of settlements) {
    const amount = toNumber(settlement.amount);
    balances.set(
      settlement.payerMemberId,
      round2((balances.get(settlement.payerMemberId) ?? 0) + amount),
    );
    balances.set(
      settlement.receiverMemberId,
      round2((balances.get(settlement.receiverMemberId) ?? 0) - amount),
    );

    settlementsPaid.set(
      settlement.payerMemberId,
      round2((settlementsPaid.get(settlement.payerMemberId) ?? 0) + amount),
    );
    settlementsReceived.set(
      settlement.receiverMemberId,
      round2(
        (settlementsReceived.get(settlement.receiverMemberId) ?? 0) + amount,
      ),
    );
  }

  const memberBalances: MemberBalance[] = members.map((member) => ({
    memberId: member.id,
    name: member.name,
    role: member.role,
    personalPaid: round2(personalPaid.get(member.id) ?? 0),
    walletContributed: round2(walletContributed.get(member.id) ?? 0),
    walletExpensesFunded: round2(walletExpensesFunded.get(member.id) ?? 0),
    settlementsPaid: round2(settlementsPaid.get(member.id) ?? 0),
    settlementsReceived: round2(settlementsReceived.get(member.id) ?? 0),
    netBalance: round2(balances.get(member.id) ?? 0),
  }));

  return {
    memberBalances,
    walletBalance: round2(walletBalance),
    unsettledAmount: round2(
      memberBalances
        .filter((member) => member.netBalance > 0)
        .reduce((sum, member) => sum + member.netBalance, 0),
    ),
  };
}

export function buildSettlementSuggestions(
  memberBalances: MemberBalance[],
): SuggestedSettlement[] {
  const creditors = memberBalances
    .filter((member) => member.netBalance > 0.009)
    .map((member) => ({
      memberId: member.memberId,
      amount: member.netBalance,
    }));
  const debtors = memberBalances
    .filter((member) => member.netBalance < -0.009)
    .map((member) => ({
      memberId: member.memberId,
      amount: -member.netBalance,
    }));

  const suggestions: SuggestedSettlement[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const amount = round2(
      Math.min(debtors[debtorIndex]!.amount, creditors[creditorIndex]!.amount),
    );

    if (amount > 0) {
      suggestions.push({
        fromMemberId: debtors[debtorIndex]!.memberId,
        toMemberId: creditors[creditorIndex]!.memberId,
        amount,
      });
    }

    debtors[debtorIndex]!.amount = round2(
      debtors[debtorIndex]!.amount - amount,
    );
    creditors[creditorIndex]!.amount = round2(
      creditors[creditorIndex]!.amount - amount,
    );

    if (debtors[debtorIndex]!.amount <= 0.009) debtorIndex += 1;
    if (creditors[creditorIndex]!.amount <= 0.009) creditorIndex += 1;
  }

  return suggestions;
}

export async function buildRangeSummary(
  db: PrismaClient,
  groupId: string,
  start: Date,
  end: Date,
) {
  const [expenses, walletEntries, settlements] = await Promise.all([
    db.expense.findMany({
      where: { groupId, date: { gte: start, lt: end } },
      include: { paidByMember: true },
    }),
    db.walletEntry.findMany({
      where: { groupId, date: { gte: start, lt: end } },
      include: { member: true },
    }),
    db.settlement.findMany({
      where: { groupId, date: { gte: start, lt: end } },
      include: { payerMember: true, receiverMember: true },
    }),
  ]);

  const totalSpent = round2(
    expenses.reduce((sum, expense) => sum + toNumber(expense.amount), 0),
  );
  const personalPayments = round2(
    expenses
      .filter((expense) => expense.paymentSource === "PERSONAL")
      .reduce((sum, expense) => sum + toNumber(expense.amount), 0),
  );
  const walletUsed = round2(
    walletEntries
      .filter((entry) => entry.type === "EXPENSE")
      .reduce((sum, entry) => sum + toNumber(entry.amount), 0),
  );
  const walletTopUps = round2(
    walletEntries
      .filter((entry) => entry.type === "CONTRIBUTION")
      .reduce((sum, entry) => sum + toNumber(entry.amount), 0),
  );
  const adjustments = round2(
    walletEntries
      .filter((entry) => entry.type === "ADJUSTMENT")
      .reduce((sum, entry) => sum + toNumber(entry.amount), 0),
  );

  const categoryTotals = new Map<string, number>();
  for (const expense of expenses) {
    categoryTotals.set(
      expense.category,
      round2(
        (categoryTotals.get(expense.category) ?? 0) + toNumber(expense.amount),
      ),
    );
  }

  const highestCategory = [...categoryTotals.entries()].sort(
    (left, right) => right[1] - left[1],
  )[0];

  const spenderTotals = new Map<string, { name: string; amount: number }>();
  for (const expense of expenses) {
    if (expense.paymentSource !== "PERSONAL" || !expense.paidByMember) continue;

    const existing = spenderTotals.get(expense.paidByMemberId ?? "") ?? {
      name: expense.paidByMember.name,
      amount: 0,
    };

    existing.amount = round2(existing.amount + toNumber(expense.amount));
    spenderTotals.set(expense.paidByMemberId ?? "", existing);
  }

  const topSpender =
    [...spenderTotals.values()].sort(
      (left, right) => right.amount - left.amount,
    )[0] ?? null;

  const contributorTotals = new Map<string, { name: string; amount: number }>();
  for (const entry of walletEntries) {
    if (entry.type !== "CONTRIBUTION" || !entry.member) continue;

    const existing = contributorTotals.get(entry.memberId ?? "") ?? {
      name: entry.member.name,
      amount: 0,
    };

    existing.amount = round2(existing.amount + toNumber(entry.amount));
    contributorTotals.set(entry.memberId ?? "", existing);
  }

  const topContributor =
    [...contributorTotals.values()].sort(
      (left, right) => right.amount - left.amount,
    )[0] ?? null;

  const dayCount = Math.max(
    1,
    Math.ceil((end.getTime() - start.getTime()) / 86400000),
  );

  return {
    totalSpent,
    personalPayments,
    walletUsed,
    walletTopUps,
    adjustments,
    highestSingleExpense: round2(
      expenses.reduce(
        (max, expense) => Math.max(max, toNumber(expense.amount)),
        0,
      ),
    ),
    averagePerDay: round2(totalSpent / dayCount),
    highestCategory: highestCategory
      ? {
          key: highestCategory[0],
          label: CATEGORY_LABELS[highestCategory[0]],
          amount: highestCategory[1],
        }
      : null,
    topSpender,
    topContributor,
    settlementsTotal: round2(
      settlements.reduce(
        (sum, settlement) => sum + toNumber(settlement.amount),
        0,
      ),
    ),
    expenseCount: expenses.length,
    settlementCount: settlements.length,
    categoryBreakdown: [...categoryTotals.entries()]
      .map(([key, amount]) => ({
        key,
        label: CATEGORY_LABELS[key],
        amount,
      }))
      .sort((left, right) => right.amount - left.amount),
  };
}
