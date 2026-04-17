import "~/styles/globals.css";

import { type Metadata } from "next";
import { Sora, Space_Grotesk } from "next/font/google";

import { AppProviders } from "~/app/providers";

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

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sora.variable} ${spaceGrotesk.variable}`}>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
