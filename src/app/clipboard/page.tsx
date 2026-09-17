import type { Metadata } from "next";
import { ClipboardPanel } from "@/components/clipboard-panel";

export const metadata: Metadata = { title: "剪切板" };

export default function ClipboardPage() {
  return <ClipboardPanel />;
}
