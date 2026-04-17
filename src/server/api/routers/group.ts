import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  generateUniqueJoinCode,
  requireGroupMembership,
} from "~/server/lib/group-access";
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

export const groupRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(2).max(60),
        description: z.string().max(240).optional(),
        type: groupTypeEnum.default("OTHER"),
        currency: z.string().length(3).default("USD"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const joinCode = await generateUniqueJoinCode(ctx.db);

      return ctx.db.$transaction(async (tx) => {
        const group = await tx.group.create({
          data: {
            name: input.name,
            description: input.description,
            type: input.type,
            currency: input.currency.toUpperCase(),
            joinCode,
          },
        });

        const creator = await tx.groupMember.create({
          data: {
            groupId: group.id,
            userId: ctx.session.user.id,
            name: ctx.session.user.name ?? "Member",
            email: ctx.session.user.email,
            image: ctx.session.user.image,
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

  list: protectedProcedure.query(async ({ ctx }) => {
    const groups = await ctx.db.group.findMany({
      where: {
        members: {
          some: {
            userId: ctx.session.user.id,
          },
        },
      },
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

  details: protectedProcedure
    .input(z.object({ groupId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const group = await ctx.db.group.findFirst({
        where: {
          id: input.groupId,
          members: {
            some: {
              userId: ctx.session.user.id,
            },
          },
        },
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

  joinByCode: protectedProcedure
    .input(
      z.object({
        code: z
          .string()
          .trim()
          .min(6)
          .max(6)
          .regex(/^[A-Z0-9]{6}$/),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const group = await ctx.db.group.findUnique({
        where: { joinCode: input.code.toUpperCase() },
      });

      if (!group) {
        throw new Error("Invalid group code");
      }

      const existing = await ctx.db.groupMember.findFirst({
        where: {
          groupId: group.id,
          userId: ctx.session.user.id,
        },
      });

      if (existing) {
        return { groupId: group.id, alreadyMember: true };
      }

      const member = await ctx.db.groupMember.create({
        data: {
          groupId: group.id,
          userId: ctx.session.user.id,
          name: ctx.session.user.name ?? "Member",
          email: ctx.session.user.email,
          image: ctx.session.user.image,
          role: "MEMBER",
        },
      });

      await ctx.db.ledgerEntry.create({
        data: {
          groupId: group.id,
          type: "WALLET_ADJUSTMENT",
          actorMemberId: member.id,
          note: `${member.name} joined the group`,
          referenceType: "member",
          referenceId: member.id,
        },
      });

      return { groupId: group.id, alreadyMember: false };
    }),

  myMemberId: protectedProcedure
    .input(z.object({ groupId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const member = await requireGroupMembership(
        ctx.db,
        ctx.session.user.id,
        input.groupId,
      );
      return { memberId: member.id, role: member.role };
    }),
});
