import { TRPCError } from "@trpc/server";

import { type PrismaClient } from "../../../generated/prisma";

const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function createJoinCode() {
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code +=
      JOIN_CODE_ALPHABET[Math.floor(Math.random() * JOIN_CODE_ALPHABET.length)];
  }
  return code;
}

export async function generateUniqueJoinCode(db: PrismaClient) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const joinCode = createJoinCode();
    const existing = await db.group.findUnique({ where: { joinCode } });
    if (!existing) return joinCode;
  }
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Could not generate a unique group code. Try again.",
  });
}

export async function requireGroupMembership(
  db: PrismaClient,
  userId: string,
  groupId: string,
) {
  const member = await db.groupMember.findFirst({
    where: { groupId, userId },
  });

  if (!member) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not a member of this private group.",
    });
  }

  return member;
}
