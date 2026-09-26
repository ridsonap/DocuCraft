import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "DocuCraft - PDF Editor",
  description: "Professional PDF editing and manipulation tool",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
