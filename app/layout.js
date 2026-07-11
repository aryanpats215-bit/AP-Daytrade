import "./globals.css";

export const metadata = {
  title: "AP Daytrade",
  description: "Autonomous multi-asset trading terminal",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
