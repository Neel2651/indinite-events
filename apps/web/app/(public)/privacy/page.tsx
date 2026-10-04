import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = { title: "Privacy policy", description: "How Indinite Events uses your personal data." };

/** UK GDPR / Data Protection Act 2018 privacy notice. Company details come from lib/legal.ts. Review with a solicitor before launch. */
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" intro="How we collect, use and protect your personal data when you book or use Indinite Events.">
      <section>
        <h2>Who we are</h2>
        <p>
          Indinite Events (events.indinite.co.uk) is run by {LEGAL.legalName}, a company registered in England and Wales. You can contact us at{" "}
          <a href={`mailto:${LEGAL.supportEmail}`}>{LEGAL.supportEmail}</a>. We&apos;re registered with the Information Commissioner&apos;s Office (ICO) under number {LEGAL.icoNumber}.
        </p>
        <p>
          We sell tickets on behalf of event organisers. For your booking, we and the organiser of your event each decide how we use your details, so we are each a separate
          &ldquo;controller&rdquo; under UK data protection law. This policy explains what we do; the organiser&apos;s own privacy policy covers what they do with the details we pass to
          them.
        </p>
        <p>
          Questions about your data: <a href={`mailto:${LEGAL.privacyEmail}`}>{LEGAL.privacyEmail}</a>.
        </p>
      </section>

      <section>
        <h2>What we collect</h2>
        <ul>
          <li>
            <strong>Booking details:</strong> your name, email address and, if you give it, phone number; what you booked, the order reference, prices, any discount code and how
            you paid.
          </li>
          <li>
            <strong>Payment details:</strong> card payments are handled by Stripe. We never see or store your full card number; Stripe tells us whether the payment succeeded.
          </li>
          <li>
            <strong>Pass and entry records:</strong> each pass has a QR code that contains a pass number and a security signature, no personal details. When your pass is scanned we
            record the time, night, gate and the staff member who scanned it.
          </li>
          <li>
            <strong>Staff accounts</strong> (organisers and Indinite staff): name, email address, role, and a record of the changes you make.
          </li>
          <li>
            <strong>Technical and security data:</strong> the IP address and browser details linked to bookings and staff actions, kept in our security and audit logs, and used to limit
            repeated attempts (for example, to stop someone guessing order references).
          </li>
          <li>
            <strong>Messages:</strong> anything you send us when you contact support.
          </li>
        </ul>
      </section>

      <section>
        <h2>How we use it, and our lawful basis</h2>
        <ul>
          <li>
            <strong>To take your booking, send your passes, let you view them and admit you to the event:</strong> performing our contract with you.
          </li>
          <li>
            <strong>To give the organiser the details they need to run the event</strong> (your name, contact details and booking, and whether you&apos;ve entered): performing the
            contract, and our and the organiser&apos;s legitimate interest in running a safe event.
          </li>
          <li>
            <strong>To handle refunds, cancellations and questions:</strong> performing the contract.
          </li>
          <li>
            <strong>To keep financial and tax records:</strong> legal obligation.
          </li>
          <li>
            <strong>To keep the service secure, prevent fraud and duplicate entry, and keep an audit trail of changes:</strong> our legitimate interests.
          </li>
          <li>
            <strong>To help organisers measure their adverts</strong> on events that use a Meta pixel (see Cookies below): the organiser&apos;s and our legitimate interest in
            promoting events.
          </li>
        </ul>
        <p>
          We don&apos;t send marketing emails from Indinite Events, and we don&apos;t sell your data. We only email you about your booking (for example your passes, a payment link,
          or a refund).
        </p>
      </section>

      <section>
        <h2>Who we share it with</h2>
        <ul>
          <li>
            <strong>The event organiser</strong> for your booking.
          </li>
          <li>
            <strong>Stripe</strong>, to take card payments and handle refunds. Stripe also uses some payment data for its own fraud prevention and legal obligations, as a controller.
          </li>
          <li>
            <strong>Resend</strong>, which sends our emails.
          </li>
          <li>
            <strong>Meta (Facebook and Instagram)</strong>, on events whose organiser uses a Meta pixel: which pages you view and the booking steps you take, with amounts (see
            Cookies below). The organiser, Indinite and Meta are joint controllers for this; Meta uses it under its own privacy policy.
          </li>
          <li>
            <strong>MongoDB Atlas</strong>, which hosts our database in London, and the provider that hosts our web server in the UK.
          </li>
          <li>Professional advisers, and the police, regulators or courts where the law requires it.</li>
        </ul>
        <p>These providers act on our instructions under written contracts, except where we say they act as a controller.</p>
      </section>

      <section>
        <h2>Transfers outside the UK</h2>
        <p>
          Some of our providers (including Stripe, Resend and Meta) may process data in the United States or elsewhere outside the UK. Where they do, the transfer is protected by
          safeguards recognised under UK law, such as the UK Extension to the EU–US Data Privacy Framework or the UK International Data Transfer Addendum to standard contractual
          clauses.
        </p>
      </section>

      <section>
        <h2>How long we keep it</h2>
        <ul>
          <li>Booking and entry details: 24 months after the event, then deleted or anonymised.</li>
          <li>Financial records (orders, payments, refunds): 6 years, as UK tax law requires. After 24 months we keep only what&apos;s needed for this.</li>
          <li>Security and audit logs: as long as the record they relate to.</li>
          <li>Staff accounts: while the account is active, then 12 months.</li>
        </ul>
      </section>

      <section>
        <h2>Your rights</h2>
        <p>
          You can ask us for a copy of your data, to correct it, to delete it, to restrict or object to how we use it, or to move it to another service. Some rights have limits (for
          example, we must keep financial records). Email <a href={`mailto:${LEGAL.privacyEmail}`}>{LEGAL.privacyEmail}</a> with your order reference; we&apos;ll reply within one
          month.
        </p>
        <p>
          If you&apos;re unhappy with how we&apos;ve handled your data, you can complain to the Information Commissioner&apos;s Office:{" "}
          <a href="https://ico.org.uk/make-a-complaint/" rel="noopener noreferrer" target="_blank">
            ico.org.uk/make-a-complaint
          </a>{" "}
          or 0303 123 1113. We&apos;d appreciate the chance to put things right first.
        </p>
      </section>

      <section>
        <h2>Cookies and similar technology</h2>
        <p>
          Customers don&apos;t need a cookie to book: links to your passes are signed and expire after 30 minutes. We use one strictly necessary cookie to keep staff signed in, and the
          gate scanner stores the pass list and the gate name on the scanning phone so it works without signal. None of these are used for tracking or advertising.
        </p>
        <p>
          <strong>Meta pixel.</strong> Some organisers advertise their event on Facebook and Instagram. On those events, the event page and the booking confirmation load the
          organiser&apos;s Meta pixel. It sets cookies and tells Meta that you viewed the page, added or removed passes, started checkout, pressed pay and completed a booking,
          with the passes&apos; ticket types and amounts, and the order reference. We never send your name, email or phone number. Meta may link this to your Facebook or
          Instagram account to show the organiser how their adverts perform and to show adverts to people likely to be interested. No other pages load it.
        </p>
        <p>
          To stop this, change your{" "}
          <a href="https://www.facebook.com/adpreferences/ad_settings" target="_blank" rel="noopener noreferrer">
            Meta ad settings
          </a>
          , block third-party cookies in your browser, or use a content blocker. Booking works the same either way. See{" "}
          <a href="https://www.facebook.com/privacy/policy/" target="_blank" rel="noopener noreferrer">
            Meta&apos;s privacy policy
          </a>
          .
        </p>
        <p>
          Event pages may include YouTube or Vimeo videos. We use YouTube&apos;s privacy-enhanced mode; YouTube or Vimeo may store data on your device when you play a video. See
          their privacy policies.
        </p>
      </section>

      <section>
        <h2>Security</h2>
        <p>
          Data is encrypted in transit (HTTPS) and at rest. Staff accounts are by invitation only and each role sees only what it needs. Every change to a booking is recorded in an
          audit log.
        </p>
      </section>

      <section>
        <h2>Children</h2>
        <p>Bookings must be made by someone aged 18 or over. We don&apos;t knowingly collect data from children, other than names on passes if an adult gives them.</p>
      </section>

      <section>
        <h2>Changes</h2>
        <p>
          We&apos;ll update this page if anything changes and show the date above. See also our <Link href="/booking-terms">booking terms</Link> and{" "}
          <Link href="/refund-policy">refund policy</Link>.
        </p>
      </section>
    </LegalPage>
  );
}
