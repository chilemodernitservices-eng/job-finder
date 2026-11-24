import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Job Finder — Find your next opportunity",
  description: "Discover relevant, verified job opportunities and manage applications in one place.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
