import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  description: "A mobile compass that points to the nearest Tim Hortons.",
  title: "Tim Compass",
};

export const viewport: Viewport = {
  initialScale: 1,
  themeColor: "#f7f0e8",
  viewportFit: "cover",
  width: "device-width",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
