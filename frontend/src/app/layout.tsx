import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RepoMedic AI — From Bug Report to Verified Fix",
  description: "Local-first AI software maintenance with reviewable patches and real test evidence."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
