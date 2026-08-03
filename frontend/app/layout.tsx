import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

// Default metadata for every route. The landing page (app/page.tsx) overrides the title with
// its own; the `template` below gives every other route a consistent suffix so a signed-in
// staff member's browser tab reads e.g. "Caseload — AMHOS" once individual pages set a title.
export const metadata: Metadata = {
  title: {
    default: "AMHOS — Maternal and newborn care coordination",
    template: "%s — AMHOS",
  },
  description:
    "Staff platform for maternal and newborn care coordination in low-resource settings.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
