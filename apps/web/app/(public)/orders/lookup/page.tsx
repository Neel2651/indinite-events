import type { Metadata } from "next";
import { LookupForm } from "@/components/lookup-form";

export const metadata: Metadata = { title: "Find my tickets" };

export default function LookupPage() {
  return (
    <>
      <section className="dark bg-background text-foreground">
        <div className="mx-auto max-w-xl px-5 py-12">
          <span className="badge-pill">FIND MY TICKETS</span>
          <h1 className="mt-5 text-3xl leading-tight sm:text-4xl">Find your tickets</h1>
          <p className="mt-3 text-muted-foreground">
            Enter the email you booked with and your order reference to see your booking and QR codes.
          </p>
        </div>
      </section>
      <section className="bg-brand-cream">
        <div className="mx-auto max-w-xl px-5 py-10">
          <div className="card-brand">
            <LookupForm />
          </div>
        </div>
      </section>
    </>
  );
}
