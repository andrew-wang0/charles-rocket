import "./globals.css";

import { SerwistProvider } from "@serwist/next/react";
import type { Metadata, Viewport } from "next";
import { JetBrains_Mono } from "next/font/google";
import React from "react";

import { DataReader } from "@/components/layout/data-reader";
import { Header } from "@/components/layout/header/header";
import { cn } from "@/lib/util/cn";

const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  applicationName: "Charles Dashboard",
  title: "Charles Dashboard",
};

export const viewport: Viewport = {
  themeColor: "#343434",
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
        <SerwistProvider swUrl="/sw.js">
          <DataReader />
          <Header />
          {children}
        </SerwistProvider>
      </body>
    </html>
  );
}
