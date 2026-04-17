"use client";

import { SessionProvider } from "next-auth/react";

import { TRPCReactProvider } from "~/trpc/react";

export function AppProviders(props: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <TRPCReactProvider>{props.children}</TRPCReactProvider>
    </SessionProvider>
  );
}
