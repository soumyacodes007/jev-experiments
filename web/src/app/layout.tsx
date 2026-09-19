import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jev Console",
  description: "HALO security classification and PRISM sensitive-data masking, powered by Jev.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
