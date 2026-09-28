import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = { title: "Refund policy", description: "When you can get a refund on passes booked through Indinite Events, and how." };

/** Matches SPEC §4.6 (ticket price only, before the event, unused passes) plus event cancellation. Review with a solicitor before launch. */
export default function RefundPolicyPage() {
  return (
    <LegalPage title="Refund policy" intro="When you can get your money back, how much, and how long it takes.">
      <section>
        <h2>If the event is cancelled</h2>
        <p>
          You&apos;ll get a full refund of everything you paid, including fees. If the event is postponed or significantly changed, you can choose a full refund instead of going. We or
          the organiser will email you about how to claim; you don&apos;t need to do anything until then.
        </p>
      </section>

      <section>
        <h2>If you can&apos;t go</h2>
        <ul>
          <li>Refunds are at the organiser&apos;s discretion. Ask as soon as you can.</li>
          <li>Refunds close when the event starts. A pass that has been used at the gate can&apos;t be refunded.</li>
          <li>
            We refund the price you paid for each refunded pass, after any discount. The platform fee, organiser charges, tax and any card processing fee aren&apos;t refunded, because
            the booking service has already been provided.
          </li>
          <li>You can refund some of the passes on a booking and keep the rest. Refunded passes stop working straight away.</li>
        </ul>
      </section>

      <section>
        <h2>How to ask</h2>
        <p>
          Email <a href={`mailto:${LEGAL.supportEmail}`}>{LEGAL.supportEmail}</a> (or the organiser) with your order reference, the email you booked with, and which passes you want to
          refund. We&apos;ll email you when it&apos;s done.
        </p>
      </section>

      <section>
        <h2>How you get the money back</h2>
        <ul>
          <li>Card payments go back to the card you paid with, usually within 5 to 10 working days.</li>
          <li>If you paid the organiser directly (in cash or by bank transfer), the organiser repays you the same way.</li>
          <li>Complimentary passes have nothing to repay.</li>
        </ul>
      </section>

      <section>
        <h2>If your payment arrived too late</h2>
        <p>
          We hold your passes while you pay. If your payment only completes after the hold ended and the passes have sold out in the meantime, we refund you in full automatically,
          including fees, and email you.
        </p>
      </section>

      <section>
        <h2>Your legal rights</h2>
        <p>
          This policy doesn&apos;t affect your rights under consumer law. There&apos;s no 14-day cancellation period for event passes (see our{" "}
          <Link href="/booking-terms">booking terms</Link>).
        </p>
      </section>
    </LegalPage>
  );
}
