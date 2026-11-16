import Link from "next/link";
import { AlerdLogo } from "@/components/AlerdLogo";

export default function NotFound() {
  return <main className="mx-auto max-w-lg px-6 py-20 text-center"><AlerdLogo size={100} className="mx-auto mb-7" /><h1 className="text-3xl font-semibold">Hier ist gerade nichts.</h1><p className="mt-3 text-[var(--fg-dim)]">Diese Seite wurde nicht gefunden oder ist für dein Konto nicht verfügbar.</p><Link href="/services" className="btn mt-7">Zurück zu den Diensten</Link></main>;
}
