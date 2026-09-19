import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PRISM — Keep the meaning. Remove the exposure.",
  description: "Semantic sensitive-data detection with deterministic masking.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
