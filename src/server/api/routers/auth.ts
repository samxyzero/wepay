import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { z } from "zod";

import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "~/server/api/trpc";

export const authRouter = createTRPCRouter({
  register: publicProcedure
    .input(
      z.object({
        name: z.string().min(2).max(60),
        email: z.string().email(),
        password: z.string().min(8).max(128),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.user.findUnique({
        where: { email: input.email.toLowerCase() },
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An account with this email already exists.",
        });
      }

      const passwordHash = await bcrypt.hash(input.password, 12);

      const user = await ctx.db.user.create({
        data: {
          name: input.name,
          email: input.email.toLowerCase(),
          passwordHash,
        },
        select: {
          id: true,
          name: true,
          email: true,
        },
      });

      return user;
    }),

  me: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.user.findUnique({
      where: { id: ctx.session.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
      },
    });

    return user;
  }),
});
