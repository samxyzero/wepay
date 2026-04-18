import "~/styles/globals.css";

import { type Metadata } from "next";
import { Sora, Space_Grotesk } from "next/font/google";

import { AppProviders } from "~/app/providers";
import { auth } from "~/server/auth";

export const metadata: Metadata = {
  title: "Wepay Shared Wallet",
  description:
    "Group expense tracking, shared wallet ledger, settlements, and weekly/monthly summaries.",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-sora",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();

  return (
    <html lang="en" className={`${sora.variable} ${spaceGrotesk.variable}`}>
      <body>
        <AppProviders session={session}>{children}</AppProviders>
      </body>
    </html>
  );
}
