import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Refund policy", description: "Passes booked through Indinite Events are non-refundable. Refund requests go to the event organiser." };

/**
 * Agreed 1 Oct 2026: passes are non-refundable; the organiser is the only point of contact for refunds (they decide
 * and make them). Event cancellation still gets a full refund (consumer law). Review with a solicitor before launch.
 */
export default function RefundPolicyPage() {
  return (
    <LegalPage title="Refund policy" intro="Passes are non-refundable. If you need a refund, contact the organiser of your event.">
      <section>
        <h2>No refunds</h2>
        <p>
          Passes are non-refundable once booked, including if you can&apos;t go. The only exceptions are an event that&apos;s cancelled or significantly changed (below), or a refund
          the organiser agrees to.
        </p>
      </section>

      <section>
        <h2>Who to contact about a refund</h2>
        <p>
          <strong>Contact the organiser of your event.</strong> The organiser runs the event and is the only point of contact for refunds: they decide whether to give one and they
          make it. Indinite sells passes on the organiser&apos;s behalf and can&apos;t give refunds or decide on refund requests.
        </p>
        <p>When you contact the organiser, give your order reference, the email you booked with, and which passes you&apos;re asking about.</p>
      </section>

      <section>
        <h2>If the event is cancelled or significantly changed</h2>
        <p>
          If the event is cancelled you&apos;re entitled to a full refund of what you paid, including fees. If it&apos;s postponed or significantly changed, you can choose a full
          refund instead of going. The organiser will contact you about how it works.
        </p>
      </section>

      <section>
        <h2>If the organiser agrees to a refund</h2>
        <ul>
          <li>Refunds can only be made before the event starts, and not for a pass that has been used at the gate.</li>
          <li>
            You get back the price you paid for each refunded pass, after any discount. The platform fee, organiser charges, tax and any card processing fee aren&apos;t refunded,
            because the booking service has already been provided.
          </li>
          <li>Some of the passes on a booking can be refunded and the rest kept. Refunded passes stop working straight away.</li>
          <li>We&apos;ll email you when a refund has been made.</li>
        </ul>
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
          including fees, and email you. You don&apos;t need to contact anyone.
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
