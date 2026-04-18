"use client";

import { type Session } from "next-auth";
import { SessionProvider } from "next-auth/react";

import { TRPCReactProvider } from "~/trpc/react";

export function AppProviders(props: {
  children: React.ReactNode;
  session?: Session | null;
}) {
  return (
    <SessionProvider session={props.session}>
      <TRPCReactProvider>{props.children}</TRPCReactProvider>
    </SessionProvider>
  );
}
