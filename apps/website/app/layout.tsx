import "./globals.css";

import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import React from "react";

import { cn } from "@/lib/utils";

const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Charles",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn("font-mono", jetbrainsMono.variable)}>
      <body className={jetbrainsMono.className}>{children}</body>
    </html>
  );
}
