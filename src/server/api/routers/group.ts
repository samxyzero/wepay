import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { computeGroupBalances } from "~/server/lib/ledger";

const groupTypeEnum = z.enum([
  "HOME",
  "TRIP",
  "FRIENDS",
  "OFFICE",
  "FAMILY",
  "CLUB",
  "OTHER",
]);

const roleEnum = z.enum(["ADMIN", "MEMBER"]);

export const groupRouter = createTRPCRouter({
  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(2).max(60),
        description: z.string().max(240).optional(),
        type: groupTypeEnum.default("OTHER"),
        currency: z.string().length(3).default("USD"),
        creatorName: z.string().min(2).max(60),
        creatorEmail: z.string().email().optional(),
        creatorPhone: z.string().max(30).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.$transaction(async (tx) => {
        const group = await tx.group.create({
          data: {
            name: input.name,
            description: input.description,
            type: input.type,
            currency: input.currency.toUpperCase(),
          },
        });

        const creator = await tx.groupMember.create({
          data: {
            groupId: group.id,
            name: input.creatorName,
            email: input.creatorEmail,
            phone: input.creatorPhone,
            role: "ADMIN",
          },
        });

        await tx.ledgerEntry.create({
          data: {
            groupId: group.id,
            type: "WALLET_ADJUSTMENT",
            actorMemberId: creator.id,
            note: "Group created",
            referenceType: "group",
            referenceId: group.id,
            metadata: {
              groupName: group.name,
            },
          },
        });

        return { groupId: group.id, creatorMemberId: creator.id };
      });
    }),

  list: publicProcedure.query(async ({ ctx }) => {
    const groups = await ctx.db.group.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        members: true,
        wallet: {
          orderBy: { date: "desc" },
          take: 200,
        },
        ledger: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    return groups.map((group) => {
      let walletBalance = 0;
      for (const entry of group.wallet) {
        const amount = entry.amount.toNumber();
        if (entry.type === "CONTRIBUTION") walletBalance += amount;
        if (entry.type === "EXPENSE" || entry.type === "WITHDRAWAL") {
          walletBalance -= amount;
        }
        if (entry.type === "ADJUSTMENT") walletBalance += amount;
      }

      return {
        id: group.id,
        name: group.name,
        description: group.description,
        type: group.type,
        currency: group.currency,
        createdAt: group.createdAt,
        memberCount: group.members.length,
        walletBalance: Math.round(walletBalance * 100) / 100,
        lastActivityAt: group.ledger[0]?.createdAt ?? group.createdAt,
      };
    });
  }),

  details: publicProcedure
    .input(z.object({ groupId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const group = await ctx.db.group.findUnique({
        where: { id: input.groupId },
        include: {
          members: {
            orderBy: [{ role: "asc" }, { name: "asc" }],
          },
        },
      });

      if (!group) {
        throw new Error("Group not found");
      }

      const balances = await computeGroupBalances(ctx.db, group.id);

      return {
        group,
        balances,
      };
    }),

  addMember: publicProcedure
    .input(
      z.object({
        groupId: z.string().cuid(),
        name: z.string().min(2).max(60),
        email: z.string().email().optional(),
        phone: z.string().max(30).optional(),
        role: roleEnum.default("MEMBER"),
        actorMemberId: z.string().cuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const member = await ctx.db.groupMember.create({
        data: {
          groupId: input.groupId,
          name: input.name,
          email: input.email,
          phone: input.phone,
          role: input.role,
        },
      });

      await ctx.db.ledgerEntry.create({
        data: {
          groupId: input.groupId,
          type: "WALLET_ADJUSTMENT",
          actorMemberId: input.actorMemberId,
          note: `${member.name} joined the group`,
          referenceType: "member",
          referenceId: member.id,
        },
      });

      return member;
    }),
});
