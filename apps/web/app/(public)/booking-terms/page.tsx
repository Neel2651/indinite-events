import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = { title: "Booking terms", description: "The terms that apply when you book passes through Indinite Events." };

/** Consumer booking terms (Consumer Rights Act 2015, Consumer Contracts Regulations 2013). Review with a solicitor before launch. */
export default function BookingTermsPage() {
  return (
    <LegalPage title="Booking terms" intro="Please read these before you book. They explain who you're buying from, what you get and what happens if plans change.">
      <section>
        <h2>1. Who you&apos;re dealing with</h2>
        <p>
          Indinite Events is run by {LEGAL.legalName} (company number {LEGAL.companyNumber}, registered office {LEGAL.registeredAddress}), &ldquo;Indinite&rdquo;, &ldquo;we&rdquo; or
          &ldquo;us&rdquo;. We sell passes as an agent for the event organiser named on the event page. The organiser runs the event and is responsible for it: the venue, the
          programme, safety and entry. Indinite provides the booking service, takes payment on the organiser&apos;s behalf and sends your passes.
        </p>
        <p>
          Contact us at <a href={`mailto:${LEGAL.supportEmail}`}>{LEGAL.supportEmail}</a>.
        </p>
      </section>

      <section>
        <h2>2. Prices and what you pay</h2>
        <ul>
          <li>Prices are in pounds sterling. Before you pay we show the full breakdown and the total, which is what you&apos;ll be charged.</li>
          <li>
            The total can include: the pass price; a platform fee (Indinite&apos;s booking fee); any organiser charges shown (for example a venue fee); tax where it applies; and,
            for some events, a card processing fee for paying by card.
          </li>
          <li>Discount codes come off the pass price before fees, and may have a minimum spend, a maximum discount, a limited number of uses and dates.</li>
        </ul>
      </section>

      <section>
        <h2>3. Your booking</h2>
        <ul>
          <li>Your booking is confirmed, and our contract with you is formed, when your payment is confirmed and we show or email your order reference.</li>
          <li>We hold your passes for up to 30 minutes while you pay (up to 24 hours for a payment link from the organiser). If payment isn&apos;t completed in time, the passes are released.</li>
          <li>Check your booking when it arrives and tell us straight away if anything is wrong.</li>
          <li>You must be 18 or over to book. You&apos;re responsible for everyone you book for.</li>
        </ul>
      </section>

      <section>
        <h2>4. No 14-day cancellation period</h2>
        <p>
          Passes are for leisure events on specific dates, so the usual 14-day right to cancel online purchases doesn&apos;t apply (regulation 28(1)(b) of the Consumer Contracts
          (Information, Cancellation and Additional Charges) Regulations 2013). You can still ask for a refund under our <Link href="/refund-policy">refund policy</Link>.
        </p>
      </section>

      <section>
        <h2>5. Your passes and entry</h2>
        <ul>
          <li>Each pass has its own QR code and is valid for the night or nights shown on it. It admits one person, once per night.</li>
          <li>The first scan of a pass on a night is the one that counts. Don&apos;t share or post your QR codes: a copy scanned before you arrive will stop your pass working.</li>
          <li>Passes can&apos;t be resold for profit. We or the organiser may cancel passes that have been resold, copied or obtained fraudulently.</li>
          <li>
            The organiser and venue may refuse entry, or ask you to leave, if you break the venue&apos;s rules, the law or the event&apos;s conditions (such as age limits or dress
            code). You won&apos;t get a refund in that case.
          </li>
          <li>Bring your passes on your phone or printed. We can resend them, and you can find them using your email and order reference on our website.</li>
        </ul>
      </section>

      <section>
        <h2>6. If the event changes or is cancelled</h2>
        <ul>
          <li>If the event is cancelled, you&apos;ll get a full refund of what you paid, including fees.</li>
          <li>
            If it&apos;s moved to another date or venue, or changed in a significant way, you can keep your passes for the new arrangements or ask for a full refund within the time
            we tell you.
          </li>
          <li>Minor changes to the programme or line-up don&apos;t give a right to a refund.</li>
        </ul>
      </section>

      <section>
        <h2>7. Our responsibility to you</h2>
        <p>
          We provide the booking service with reasonable care and skill. We&apos;re not responsible for the event itself, which is the organiser&apos;s responsibility. We&apos;re not
          liable for losses we couldn&apos;t reasonably foresee, or for events outside our control. Nothing in these terms limits liability for death or personal injury caused by
          negligence, for fraud, or your legal rights as a consumer (for example under the Consumer Rights Act 2015).
        </p>
      </section>

      <section>
        <h2>8. Your personal data</h2>
        <p>
          We use your details to handle your booking and share them with the organiser, as explained in our <Link href="/privacy">privacy policy</Link>.
        </p>
      </section>

      <section>
        <h2>9. Complaints and law</h2>
        <p>
          If you&apos;re unhappy, email <a href={`mailto:${LEGAL.supportEmail}`}>{LEGAL.supportEmail}</a> with your order reference and we&apos;ll try to put it right. These terms are
          governed by the law of England and Wales. If you live in Scotland or Northern Ireland, you can also bring proceedings there, and you keep the protection of your local
          consumer law.
        </p>
      </section>
    </LegalPage>
  );
}
