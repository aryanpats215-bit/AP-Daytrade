import "./globals.css";

export const metadata = {
  title: "CORE-AI // Trading Engine",
  description: "Autonomous multi-asset trading terminal",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
