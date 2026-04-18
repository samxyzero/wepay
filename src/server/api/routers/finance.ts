import { z } from "zod";

import { requireGroupMembership } from "~/server/lib/group-access";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  buildRangeSummary,
  buildSettlementSuggestions,
  computeGroupBalances,
  getDateRange,
  getPreviousRange,
} from "~/server/lib/ledger";

const splitTypeEnum = z.enum(["EQUAL", "CUSTOM"]);
const paymentSourceEnum = z.enum(["PERSONAL", "WALLET"]);
const categoryEnum = z.enum([
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
]);

const round2 = (value: number) => Math.round(value * 100) / 100;

export const financeRouter = createTRPCRouter({
  addExpense: protectedProcedure
    .input(
      z
        .object({
          groupId: z.string().cuid(),
          title: z.string().min(2).max(100),
          notes: z.string().max(300).optional(),
          amount: z.number().positive(),
          date: z.coerce.date().optional(),
          category: categoryEnum.default("OTHER"),
          splitType: splitTypeEnum.default("EQUAL"),
          paymentSource: paymentSourceEnum.default("PERSONAL"),
          paidByMemberId: z.string().cuid().optional(),
          createdByMemberId: z.string().cuid().optional(),
          participantIds: z.array(z.string().cuid()).optional(),
          customShares: z
            .array(
              z.object({
                memberId: z.string().cuid(),
                share: z.number().positive(),
              }),
            )
            .optional(),
          receiptImageUrl: z.string().url().optional(),
        })
        .superRefine((value, ctx) => {
          if (value.paymentSource === "PERSONAL" && !value.paidByMemberId) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Paid by is required for personal payments.",
              path: ["paidByMemberId"],
            });
          }
          if (
            value.splitType === "EQUAL" &&
            (!value.participantIds || value.participantIds.length === 0)
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "At least one participant is required for equal split.",
              path: ["participantIds"],
            });
          }
          if (
            value.splitType === "CUSTOM" &&
            (!value.customShares || value.customShares.length === 0)
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Custom shares are required for custom split.",
              path: ["customShares"],
            });
          }
        }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireGroupMembership(ctx.db, ctx.session.user.id, input.groupId);
      const amount = round2(input.amount);

      const participants =
        input.splitType === "EQUAL"
          ? (() => {
              const ids = [...new Set(input.participantIds ?? [])];
              const base = round2(amount / ids.length);
              const rows = ids.map((id) => ({ memberId: id, share: base }));
              const total = rows.reduce((sum, row) => sum + row.share, 0);
              const diff = round2(amount - total);
              if (rows.length > 0 && diff !== 0)
                rows[rows.length - 1]!.share = round2(
                  rows[rows.length - 1]!.share + diff,
                );
              return rows;
            })()
          : (input.customShares ?? []).map((row) => ({
              memberId: row.memberId,
              share: round2(row.share),
            }));

      const participantTotal = round2(
        participants.reduce((sum, row) => sum + row.share, 0),
      );
      if (Math.abs(participantTotal - amount) > 0.01) {
        throw new Error("Participant shares must equal total expense amount.");
      }

      const expense = await ctx.db.$transaction(async (tx) => {
        const created = await tx.expense.create({
          data: {
            groupId: input.groupId,
            title: input.title,
            notes: input.notes,
            amount,
            date: input.date ?? new Date(),
            category: input.category,
            splitType: input.splitType,
            paymentSource: input.paymentSource,
            paidByMemberId: input.paidByMemberId,
            createdByMemberId: input.createdByMemberId ?? input.paidByMemberId,
            receiptImageUrl: input.receiptImageUrl,
            participants: {
              createMany: {
                data: participants,
              },
            },
          },
          include: { participants: true },
        });

        if (input.paymentSource === "WALLET") {
          await tx.walletEntry.create({
            data: {
              groupId: input.groupId,
              memberId: input.paidByMemberId,
              type: "EXPENSE",
              amount,
              note: `Wallet expense: ${input.title}`,
              date: input.date ?? new Date(),
              expenseId: created.id,
            },
          });
        }

        await tx.ledgerEntry.create({
          data: {
            groupId: input.groupId,
            type:
              input.paymentSource === "WALLET"
                ? "EXPENSE_WALLET"
                : "EXPENSE_PERSONAL",
            actorMemberId: input.paidByMemberId,
            amount,
            note: input.title,
            referenceType: "expense",
            referenceId: created.id,
            metadata: {
              category: input.category,
              splitType: input.splitType,
              paymentSource: input.paymentSource,
            },
          },
        });

        return created;
      });

      return expense;
    }),

  addWalletContribution: protectedProcedure
    .input(
      z.object({
        groupId: z.string().cuid(),
        memberId: z.string().cuid(),
        amount: z.number().positive(),
        date: z.coerce.date().optional(),
        note: z.string().max(240).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireGroupMembership(ctx.db, ctx.session.user.id, input.groupId);
      const amount = round2(input.amount);
      return ctx.db.$transaction(async (tx) => {
        const entry = await tx.walletEntry.create({
          data: {
            groupId: input.groupId,
            memberId: input.memberId,
            type: "CONTRIBUTION",
            amount,
            note: input.note,
            date: input.date ?? new Date(),
          },
        });

        await tx.ledgerEntry.create({
          data: {
            groupId: input.groupId,
            type: "WALLET_CONTRIBUTION",
            actorMemberId: input.memberId,
            amount,
            note: input.note ?? "Wallet top-up",
            referenceType: "wallet",
            referenceId: entry.id,
          },
        });

        return entry;
      });
    }),

  addWalletAdjustment: protectedProcedure
    .input(
      z.object({
        groupId: z.string().cuid(),
        amount: z.number(),
        date: z.coerce.date().optional(),
        actorMemberId: z.string().cuid().optional(),
        note: z.string().min(2).max(240),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireGroupMembership(ctx.db, ctx.session.user.id, input.groupId);
      const amount = round2(input.amount);
      return ctx.db.$transaction(async (tx) => {
        const entry = await tx.walletEntry.create({
          data: {
            groupId: input.groupId,
            memberId: input.actorMemberId,
            type: "ADJUSTMENT",
            amount,
            date: input.date ?? new Date(),
            note: input.note,
          },
        });

        await tx.ledgerEntry.create({
          data: {
            groupId: input.groupId,
            type: "WALLET_ADJUSTMENT",
            actorMemberId: input.actorMemberId,
            amount,
            note: input.note,
            referenceType: "wallet",
            referenceId: entry.id,
          },
        });

        return entry;
      });
    }),

  addSettlement: protectedProcedure
    .input(
      z.object({
        groupId: z.string().cuid(),
        payerMemberId: z.string().cuid(),
        receiverMemberId: z.string().cuid(),
        amount: z.number().positive(),
        date: z.coerce.date().optional(),
        note: z.string().max(240).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const currentMember = await requireGroupMembership(
        ctx.db,
        ctx.session.user.id,
        input.groupId,
      );

      if (currentMember.id !== input.payerMemberId) {
        throw new Error(
          "You can only record settlement payments made by your own account.",
        );
      }

      if (input.payerMemberId === input.receiverMemberId) {
        throw new Error("Payer and receiver cannot be the same member.");
      }

      const amount = round2(input.amount);
      return ctx.db.$transaction(async (tx) => {
        const settlement = await tx.settlement.create({
          data: {
            groupId: input.groupId,
            payerMemberId: input.payerMemberId,
            receiverMemberId: input.receiverMemberId,
            amount,
            date: input.date ?? new Date(),
            note: input.note,
          },
        });

        await tx.ledgerEntry.create({
          data: {
            groupId: input.groupId,
            type: "SETTLEMENT_PAYMENT",
            actorMemberId: input.payerMemberId,
            amount,
            note: input.note ?? "Settlement payment",
            referenceType: "settlement",
            referenceId: settlement.id,
            metadata: {
              receiverMemberId: input.receiverMemberId,
            },
          },
        });

        return settlement;
      });
    }),

  dashboard: protectedProcedure
    .input(z.object({ groupId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await requireGroupMembership(ctx.db, ctx.session.user.id, input.groupId);
      const group = await ctx.db.group.findUnique({
        where: { id: input.groupId },
        include: {
          members: { orderBy: [{ role: "asc" }, { name: "asc" }] },
        },
      });
      if (!group) throw new Error("Group not found");

      const balances = await computeGroupBalances(ctx.db, input.groupId);
      const suggestions = buildSettlementSuggestions(balances.memberBalances);
      const recentActivity = await ctx.db.ledgerEntry.findMany({
        where: { groupId: input.groupId },
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { actorMember: true },
      });

      const thisWeek = getDateRange("week");
      const thisMonth = getDateRange("month");

      const [weeklySummary, monthlySummary] = await Promise.all([
        buildRangeSummary(ctx.db, input.groupId, thisWeek.start, thisWeek.end),
        buildRangeSummary(
          ctx.db,
          input.groupId,
          thisMonth.start,
          thisMonth.end,
        ),
      ]);

      return {
        group,
        balances,
        suggestions,
        recentActivity,
        weeklySummary,
        monthlySummary,
      };
    }),

  walletLedger: protectedProcedure
    .input(
      z.object({
        groupId: z.string().cuid(),
        take: z.number().int().positive().max(300).default(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireGroupMembership(ctx.db, ctx.session.user.id, input.groupId);
      const entries = await ctx.db.walletEntry.findMany({
        where: { groupId: input.groupId },
        include: { member: true, expense: true },
        orderBy: { date: "desc" },
        take: input.take,
      });

      let runningBalance = 0;
      const reversed = [...entries].reverse();
      const withBalances = reversed.map((entry) => {
        const amount = entry.amount.toNumber();
        if (entry.type === "CONTRIBUTION") runningBalance += amount;
        if (entry.type === "EXPENSE" || entry.type === "WITHDRAWAL")
          runningBalance -= amount;
        if (entry.type === "ADJUSTMENT") runningBalance += amount;
        return {
          ...entry,
          balanceAfter: round2(runningBalance),
        };
      });

      return withBalances.reverse();
    }),

  report: protectedProcedure
    .input(
      z.object({
        groupId: z.string().cuid(),
        range: z.enum(["week", "month", "custom"]).default("month"),
        startDate: z.coerce.date().optional(),
        endDate: z.coerce.date().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireGroupMembership(ctx.db, ctx.session.user.id, input.groupId);
      const current = getDateRange(input.range, input.startDate, input.endDate);
      const previous = getPreviousRange(current.start, current.end);

      const [currentSummary, previousSummary, balances] = await Promise.all([
        buildRangeSummary(ctx.db, input.groupId, current.start, current.end),
        buildRangeSummary(ctx.db, input.groupId, previous.start, previous.end),
        computeGroupBalances(ctx.db, input.groupId),
      ]);

      const spendDelta = round2(
        currentSummary.totalSpent - previousSummary.totalSpent,
      );
      const spendDeltaPct =
        previousSummary.totalSpent === 0
          ? null
          : round2((spendDelta / previousSummary.totalSpent) * 100);

      return {
        range: current,
        currentSummary,
        previousSummary,
        spendDelta,
        spendDeltaPct,
        unsettledAmount: balances.unsettledAmount,
      };
    }),

  history: protectedProcedure
    .input(
      z.object({
        groupId: z.string().cuid(),
        range: z.enum(["week", "month", "custom"]).default("month"),
        startDate: z.coerce.date().optional(),
        endDate: z.coerce.date().optional(),
        take: z.number().int().positive().max(300).default(120),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireGroupMembership(ctx.db, ctx.session.user.id, input.groupId);

      const range = getDateRange(input.range, input.startDate, input.endDate);

      const entries = await ctx.db.ledgerEntry.findMany({
        where: {
          groupId: input.groupId,
          createdAt: {
            gte: range.start,
            lt: range.end,
          },
        },
        orderBy: { createdAt: "desc" },
        take: input.take,
        include: { actorMember: true },
      });

      const members = await ctx.db.groupMember.findMany({
        where: { groupId: input.groupId },
        select: { id: true, name: true },
      });
      const memberMap = new Map(
        members.map((member) => [member.id, member.name]),
      );

      const expenseIds = entries
        .filter(
          (entry) =>
            entry.referenceType === "expense" && Boolean(entry.referenceId),
        )
        .map((entry) => entry.referenceId!);
      const settlementIds = entries
        .filter(
          (entry) =>
            entry.referenceType === "settlement" && Boolean(entry.referenceId),
        )
        .map((entry) => entry.referenceId!);
      const walletIds = entries
        .filter(
          (entry) =>
            entry.referenceType === "wallet" && Boolean(entry.referenceId),
        )
        .map((entry) => entry.referenceId!);

      const [expenses, settlements, walletEntries] = await Promise.all([
        expenseIds.length
          ? ctx.db.expense.findMany({
              where: { id: { in: expenseIds } },
              include: { participants: true, paidByMember: true },
            })
          : Promise.resolve([]),
        settlementIds.length
          ? ctx.db.settlement.findMany({
              where: { id: { in: settlementIds } },
              include: { payerMember: true, receiverMember: true },
            })
          : Promise.resolve([]),
        walletIds.length
          ? ctx.db.walletEntry.findMany({
              where: { id: { in: walletIds } },
              include: { member: true, expense: true },
            })
          : Promise.resolve([]),
      ]);

      const expenseMap = new Map(
        expenses.map((expense) => [expense.id, expense]),
      );
      const settlementMap = new Map(
        settlements.map((settlement) => [settlement.id, settlement]),
      );
      const walletMap = new Map(
        walletEntries.map((entry) => [entry.id, entry]),
      );

      const rows = entries.map((entry) => {
        const amount = entry.amount?.toNumber() ?? null;

        if (entry.referenceType === "expense" && entry.referenceId) {
          const expense = expenseMap.get(entry.referenceId);
          const participantCount = expense?.participants.length ?? 0;

          return {
            id: entry.id,
            type: entry.type,
            createdAt: entry.createdAt,
            actorName: entry.actorMember?.name ?? "System",
            amount,
            note: entry.note,
            details: {
              title: expense?.title ?? entry.note ?? "Expense",
              paymentSource: expense?.paymentSource ?? null,
              category: expense?.category ?? null,
              participantCount,
              paidBy: expense?.paidByMember?.name ?? null,
              expenseDate: expense?.date ?? null,
            },
          };
        }

        if (entry.referenceType === "settlement" && entry.referenceId) {
          const settlement = settlementMap.get(entry.referenceId);
          const payerName =
            settlement?.payerMember?.name ?? entry.actorMember?.name;
          const receiverName = settlement?.receiverMember?.name ?? null;

          return {
            id: entry.id,
            type: entry.type,
            createdAt: entry.createdAt,
            actorName: entry.actorMember?.name ?? "System",
            amount,
            note: entry.note,
            details: {
              payerName,
              receiverName,
              settlementDate: settlement?.date ?? null,
              settlementNote: settlement?.note ?? null,
            },
          };
        }

        if (entry.referenceType === "wallet" && entry.referenceId) {
          const wallet = walletMap.get(entry.referenceId);
          return {
            id: entry.id,
            type: entry.type,
            createdAt: entry.createdAt,
            actorName: entry.actorMember?.name ?? "System",
            amount,
            note: entry.note,
            details: {
              walletType: wallet?.type ?? null,
              walletActor: wallet?.member?.name ?? null,
              walletDate: wallet?.date ?? null,
              walletNote: wallet?.note ?? null,
              expenseTitle: wallet?.expense?.title ?? null,
            },
          };
        }

        return {
          id: entry.id,
          type: entry.type,
          createdAt: entry.createdAt,
          actorName: entry.actorMember?.name ?? "System",
          amount,
          note: entry.note,
          details: {
            metadata: entry.metadata,
            receiverName:
              typeof entry.metadata === "object" &&
              entry.metadata &&
              "receiverMemberId" in entry.metadata
                ? (memberMap.get(
                    String(
                      (
                        entry.metadata as {
                          receiverMemberId?: string;
                        }
                      ).receiverMemberId,
                    ),
                  ) ?? null)
                : null,
          },
        };
      });

      return {
        range,
        rows,
      };
    }),
});
