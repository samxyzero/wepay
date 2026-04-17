import { type PrismaClient } from "../../../generated/prisma";

const round2 = (value: number) => Math.round(value * 100) / 100;
const toNumber = (value: { toNumber(): number } | number) =>
  typeof value === "number" ? value : value.toNumber();

export type MemberBalance = {
  memberId: string;
  name: string;
  role: "ADMIN" | "MEMBER";
  personalPaid: number;
  walletContributed: number;
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

export async function computeGroupBalances(db: PrismaClient, groupId: string) {
  const [members, expenses, settlements, walletEntries] = await Promise.all([
    db.groupMember.findMany({ where: { groupId } }),
    db.expense.findMany({
      where: { groupId },
      include: { participants: true },
      orderBy: { date: "asc" },
    }),
    db.settlement.findMany({ where: { groupId }, orderBy: { date: "asc" } }),
    db.walletEntry.findMany({ where: { groupId }, orderBy: { date: "asc" } }),
  ]);

  const balances = new Map<string, number>();
  const personalPaid = new Map<string, number>();
  const walletContributed = new Map<string, number>();
  const settlementsPaid = new Map<string, number>();
  const settlementsReceived = new Map<string, number>();

  for (const member of members) {
    balances.set(member.id, 0);
    personalPaid.set(member.id, 0);
    walletContributed.set(member.id, 0);
    settlementsPaid.set(member.id, 0);
    settlementsReceived.set(member.id, 0);
  }

  for (const expense of expenses) {
    const amount = toNumber(expense.amount);

    if (expense.paymentSource === "PERSONAL" && expense.paidByMemberId) {
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
  }

  for (const settlement of settlements) {
    const amount = toNumber(settlement.amount);
    balances.set(
      settlement.payerMemberId,
      round2((balances.get(settlement.payerMemberId) ?? 0) - amount),
    );
    balances.set(
      settlement.receiverMemberId,
      round2((balances.get(settlement.receiverMemberId) ?? 0) + amount),
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

  let walletBalance = 0;
  for (const entry of walletEntries) {
    const amount = toNumber(entry.amount);
    if (entry.type === "CONTRIBUTION") {
      walletBalance += amount;
      if (entry.memberId) {
        walletContributed.set(
          entry.memberId,
          round2((walletContributed.get(entry.memberId) ?? 0) + amount),
        );
      }
    }
    if (entry.type === "EXPENSE" || entry.type === "WITHDRAWAL") {
      walletBalance -= amount;
    }
    if (entry.type === "ADJUSTMENT") {
      walletBalance += amount;
    }
  }

  const memberBalances: MemberBalance[] = members.map((member) => ({
    memberId: member.id,
    name: member.name,
    role: member.role,
    personalPaid: round2(personalPaid.get(member.id) ?? 0),
    walletContributed: round2(walletContributed.get(member.id) ?? 0),
    settlementsPaid: round2(settlementsPaid.get(member.id) ?? 0),
    settlementsReceived: round2(settlementsReceived.get(member.id) ?? 0),
    netBalance: round2(balances.get(member.id) ?? 0),
  }));

  return {
    memberBalances,
    walletBalance: round2(walletBalance),
    unsettledAmount: round2(
      memberBalances
        .filter((x) => x.netBalance > 0)
        .reduce((sum, x) => sum + x.netBalance, 0),
    ),
  };
}

export function buildSettlementSuggestions(
  memberBalances: MemberBalance[],
): SuggestedSettlement[] {
  const creditors = memberBalances
    .filter((m) => m.netBalance > 0.009)
    .map((m) => ({ memberId: m.memberId, amount: m.netBalance }));
  const debtors = memberBalances
    .filter((m) => m.netBalance < -0.009)
    .map((m) => ({ memberId: m.memberId, amount: -m.netBalance }));

  const suggestions: SuggestedSettlement[] = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const amount = round2(Math.min(debtors[i]!.amount, creditors[j]!.amount));

    if (amount > 0) {
      suggestions.push({
        fromMemberId: debtors[i]!.memberId,
        toMemberId: creditors[j]!.memberId,
        amount,
      });
    }

    debtors[i]!.amount = round2(debtors[i]!.amount - amount);
    creditors[j]!.amount = round2(creditors[j]!.amount - amount);

    if (debtors[i]!.amount <= 0.009) i += 1;
    if (creditors[j]!.amount <= 0.009) j += 1;
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
    expenses.reduce((sum, e) => sum + toNumber(e.amount), 0),
  );
  const personalPayments = round2(
    expenses
      .filter((e) => e.paymentSource === "PERSONAL")
      .reduce((sum, e) => sum + toNumber(e.amount), 0),
  );
  const walletUsed = round2(
    walletEntries
      .filter((e) => e.type === "EXPENSE")
      .reduce((sum, e) => sum + toNumber(e.amount), 0),
  );
  const walletTopUps = round2(
    walletEntries
      .filter((e) => e.type === "CONTRIBUTION")
      .reduce((sum, e) => sum + toNumber(e.amount), 0),
  );
  const adjustments = round2(
    walletEntries
      .filter((e) => e.type === "ADJUSTMENT")
      .reduce((sum, e) => sum + toNumber(e.amount), 0),
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
    (a, b) => b[1] - a[1],
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
    [...spenderTotals.values()].sort((a, b) => b.amount - a.amount)[0] ?? null;

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
    [...contributorTotals.values()].sort((a, b) => b.amount - a.amount)[0] ??
    null;

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
    categoryBreakdown: [...categoryTotals.entries()].map(([key, amount]) => ({
      key,
      label: CATEGORY_LABELS[key],
      amount,
    })),
  };
}
