import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  appleWebApp: {
    capable: true,
    title: "Tim Compass",
  },
  applicationName: "Tim Compass",
  description: "A tiny mobile compass that points to the nearest Tim Hortons.",
  icons: {
    apple: "/apple-touch-icon.png",
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  },
  metadataBase: new URL("https://tim-compass.vercel.app"),
  openGraph: {
    description: "A tiny mobile compass that points to the nearest Tim Hortons.",
    images: [
      {
        alt: "Tim Compass mobile compass preview",
        height: 630,
        url: "/social-card.png",
        width: 1200,
      },
    ],
    siteName: "Tim Compass",
    title: "Tim Compass",
    type: "website",
    url: "https://tim-compass.vercel.app",
  },
  title: {
    default: "Tim Compass",
    template: "%s | Tim Compass",
  },
  twitter: {
    card: "summary_large_image",
    description: "A tiny mobile compass that points to the nearest Tim Hortons.",
    images: ["/social-card.png"],
    title: "Tim Compass",
  },
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
