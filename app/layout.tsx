import type { Metadata } from "next";
import "../public/style.css";
export const metadata: Metadata = { title: "Trivia Stakes - Bid on your brain", description: "Live trivia auctions for 2-8 friends. Join by room code and bid on what you know.", icons: { icon: "/favicon.svg" } };
export default function RootLayout({children}: {children: React.ReactNode}) {return <html lang="en"><body>{children}</body></html>;}
