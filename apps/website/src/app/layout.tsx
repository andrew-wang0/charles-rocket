import "./globals.css";

import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import React from "react";

import { DataReader } from "@/components/layout/data-reader";
import { Header } from "@/components/layout/header/header";
import { cn } from "@/lib/util/cn";

const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Charles Dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn("font-mono", jetbrainsMono.variable)}>
      <body
        className={cn(jetbrainsMono.className, "flex h-dvh flex-col overflow-hidden select-none")}
      >
        <DataReader />
        <Header />
        {children}
      </body>
    </html>
  );
}
