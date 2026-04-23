import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Flash Repo Visualizer · v2",
  description: "Cross-repo branch alignment, contract drift, and merged history for Flash repos.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="/dashboard.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
