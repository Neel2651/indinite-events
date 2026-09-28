/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from "@react-email/components";
import { bodyFontStack, brand, fontStack } from "./theme";

const p = { fontFamily: bodyFontStack, color: brand.body, fontSize: "15px", lineHeight: "24px", margin: "0 0 12px" } as const;
const button = {
  backgroundColor: brand.orange,
  color: brand.white,
  fontFamily: fontStack,
  fontWeight: 700,
  fontSize: "15px",
  padding: "14px 28px",
  borderRadius: "999px",
} as const;

function Shell({ preview, title, children }: { preview: string; title: string; children: React.ReactNode }) {
  return (
    <Html lang="en-GB">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: brand.cream, margin: 0, padding: "24px 0" }}>
        <Container style={{ maxWidth: "560px", backgroundColor: brand.white, borderRadius: "20px", overflow: "hidden" }}>
          <Section style={{ backgroundColor: brand.navy, padding: "28px 32px" }}>
            <Text style={{ fontFamily: fontStack, color: brand.white, fontSize: "18px", fontWeight: 700, margin: 0 }}>
              <span style={{ color: brand.orangeLight }}>INDINITE</span> events
            </Text>
            <Heading as="h1" style={{ fontFamily: fontStack, color: brand.white, fontSize: "24px", margin: "16px 0 0" }}>
              {title}
            </Heading>
          </Section>
          <Section style={{ padding: "28px 32px" }}>{children}</Section>
        </Container>
      </Body>
    </Html>
  );
}

export interface InvitationEmailData {
  organizationName: string;
  role: string;
  inviterName: string;
  url: string;
}

export const invitationSubject = (d: InvitationEmailData) => `You're invited to ${d.organizationName} on Indinite Events`;

export function InvitationEmail(d: InvitationEmailData) {
  return (
    <Shell preview={`${d.inviterName} invited you to join ${d.organizationName}`} title={`Join ${d.organizationName}`}>
      <Text style={p}>
        {d.inviterName} has invited you to join <strong style={{ color: brand.ink }}>{d.organizationName}</strong> on Indinite
        Events as <strong style={{ color: brand.ink }}>{d.role}</strong>.
      </Text>
      <Button href={d.url} style={button}>
        Accept invitation
      </Button>
      <Text style={{ ...p, fontSize: "13px", marginTop: "16px" }}>
        The invitation expires in 7 days. If you weren&apos;t expecting it, you can ignore this email.
      </Text>
    </Shell>
  );
}

export interface ResetPasswordEmailData {
  name: string;
  url: string;
}

export const resetPasswordSubject = () => "Reset your Indinite Events password";

export function ResetPasswordEmail(d: ResetPasswordEmailData) {
  return (
    <Shell preview="Reset your password" title="Reset your password">
      <Text style={p}>Hi {d.name.split(" ")[0]},</Text>
      <Text style={p}>We got a request to reset the password for your Indinite Events account.</Text>
      <Button href={d.url} style={button}>
        Choose a new password
      </Button>
      <Text style={{ ...p, fontSize: "13px", marginTop: "16px" }}>
        The link works for 1 hour. If you didn&apos;t ask for this, you can ignore this email and your password stays the same.
      </Text>
    </Shell>
  );
}

export interface PaymentLinkEmailData {
  customerName: string;
  eventTitle: string;
  organizerName: string;
  publicId: string;
  totalText: string;
  expiresText: string;
  url: string;
  lines: { label: string; amount: string }[];
}

export const paymentLinkSubject = (d: PaymentLinkEmailData) => `Complete your booking for ${d.eventTitle}`;

export function PaymentLinkEmail(d: PaymentLinkEmailData) {
  return (
    <Shell preview={`Pay ${d.totalText} to confirm your passes`} title="Complete your booking">
      <Text style={p}>Hi {d.customerName.split(" ")[0]},</Text>
      <Text style={p}>
        {d.organizerName} has reserved passes for you for <strong style={{ color: brand.ink }}>{d.eventTitle}</strong>. Pay to confirm them and we&apos;ll email your passes straight away.
      </Text>
      <table style={{ width: "100%", borderCollapse: "collapse", margin: "8px 0 18px", fontFamily: bodyFontStack, fontSize: "14px", color: brand.ink }}>
        <tbody>
          {d.lines.map((l) => (
            <tr key={l.label}>
              <td style={{ padding: "6px 0", borderTop: `1px solid ${brand.border}` }}>{l.label}</td>
              <td style={{ padding: "6px 0", borderTop: `1px solid ${brand.border}`, textAlign: "right" }}>{l.amount}</td>
            </tr>
          ))}
          <tr>
            <td style={{ padding: "8px 0", borderTop: `1px solid ${brand.border}`, fontWeight: 700 }}>Total</td>
            <td style={{ padding: "8px 0", borderTop: `1px solid ${brand.border}`, textAlign: "right", fontWeight: 700 }}>{d.totalText}</td>
          </tr>
        </tbody>
      </table>
      <Button href={d.url} style={button}>
        Pay {d.totalText}
      </Button>
      <Text style={{ ...p, fontSize: "13px", marginTop: "16px" }}>
        Order {d.publicId}. Your passes are held until {d.expiresText}; after that they&apos;re released.
      </Text>
    </Shell>
  );
}

export interface MerchantEmailData {
  organizationName: string;
  url: string;
}

export const merchantSetupSubject = (d: MerchantEmailData) => `Set up card payments for ${d.organizationName}`;

/** Owner: finish Stripe onboarding (links to our Payments page, which makes a fresh Stripe link). */
export function MerchantSetupEmail(d: MerchantEmailData) {
  return (
    <Shell preview="Connect a bank account to receive ticket money" title="Set up card payments">
      <Text style={p}>
        To sell tickets online for <strong style={{ color: brand.ink }}>{d.organizationName}</strong>, connect your business to Stripe, our payment
        provider. You&apos;ll add your bank details and confirm your identity on Stripe&apos;s secure page; it usually takes about 10 minutes.
      </Text>
      <Button href={d.url} style={button}>
        Set up payments
      </Button>
      <Text style={{ ...p, fontSize: "13px", marginTop: "16px" }}>
        Sign in with your Indinite Events account, then choose &ldquo;Set up payments with Stripe&rdquo;. Indinite never sees your bank or ID details.
      </Text>
    </Shell>
  );
}

export const merchantActiveSubject = (d: MerchantEmailData) => `${d.organizationName} can now take card payments`;

export function MerchantActiveEmail(d: MerchantEmailData) {
  return (
    <Shell preview="Stripe has approved your account" title="You can take card payments">
      <Text style={p}>
        Stripe has approved <strong style={{ color: brand.ink }}>{d.organizationName}</strong>. Customers can now pay by card online and through payment
        links, and ticket money is paid out to your bank account by Stripe.
      </Text>
      <Button href={d.url} style={button}>
        View payments
      </Button>
    </Shell>
  );
}

export interface RefundEmailData {
  customerName: string;
  eventTitle: string;
  publicId: string;
  /** cancelled: staff cancelled the booking; stripe_refund: refunded in full through Stripe. */
  kind: "refund" | "sold_out" | "cancelled" | "stripe_refund";
  amountText: string;
  passes: number;
  method: "stripe" | "stripe_dashboard" | "outside_indinite" | "none";
  /** Cancelled bookings: how it was paid (so we say who repays, if anyone). */
  offlineMethod?: "cash" | "bank_transfer" | "complimentary" | null;
  policyUrl: string;
}

export const refundSubject = (d: RefundEmailData) =>
  d.kind === "sold_out"
    ? `Your booking for ${d.eventTitle} couldn't be completed`
    : d.kind === "cancelled"
      ? `Your booking for ${d.eventTitle} has been cancelled (${d.publicId})`
      : `Refund for ${d.eventTitle} (${d.publicId})`;

/** Customer: refund confirmation, or apology + full refund when passes sold out during a late payment. */
export function RefundEmail(d: RefundEmailData) {
  const how =
    d.method === "stripe" || d.method === "stripe_dashboard"
      ? "It goes back to the card you paid with and usually shows within 5–10 working days."
      : d.method === "outside_indinite"
        ? "You paid the organiser directly, so they'll repay you the same way."
        : "These were complimentary passes, so there's nothing to repay.";
  if (d.kind === "cancelled") {
    const repay =
      d.method === "stripe"
        ? `Your card payment of ${d.amountText} has been refunded in full. ${how}`
        : d.offlineMethod === "complimentary"
          ? "These were complimentary passes, so there's nothing to repay."
          : "You paid the organiser directly, so please contact them about any repayment.";
    return (
      <Shell preview="Your booking has been cancelled" title="Booking cancelled">
        <Text style={p}>Hi {d.customerName.split(" ")[0]},</Text>
        <Text style={p}>
          Your booking <strong style={{ color: brand.ink }}>{d.publicId}</strong> for {d.eventTitle} has been cancelled by the organiser. Its passes no longer work at the gate.
        </Text>
        <Text style={p}>{repay}</Text>
        <Text style={{ ...p, fontSize: "13px" }}>If you think this is a mistake, reply to the organiser or contact us.</Text>
      </Shell>
    );
  }
  if (d.kind === "stripe_refund") {
    return (
      <Shell preview={`Refund of ${d.amountText}`} title="Your refund">
        <Text style={p}>Hi {d.customerName.split(" ")[0]},</Text>
        <Text style={p}>
          Your booking <strong style={{ color: brand.ink }}>{d.publicId}</strong> for {d.eventTitle} has been refunded: <strong style={{ color: brand.ink }}>{d.amountText}</strong>. Its passes no longer work at the gate.
        </Text>
        <Text style={p}>{how}</Text>
      </Shell>
    );
  }
  return (
    <Shell preview={d.kind === "sold_out" ? "We've refunded your payment in full" : `Refund of ${d.amountText}`} title={d.kind === "sold_out" ? "Sorry, those passes sold out" : "Your refund"}>
      <Text style={p}>Hi {d.customerName.split(" ")[0]},</Text>
      {d.kind === "sold_out" ? (
        <Text style={p}>
          Your payment for <strong style={{ color: brand.ink }}>{d.eventTitle}</strong> reached us after your reserved passes were released, and they sold
          out in the meantime. We&apos;re sorry. We&apos;ve refunded the full <strong style={{ color: brand.ink }}>{d.amountText}</strong>, including fees.
        </Text>
      ) : (
        <Text style={p}>
          The organiser has refunded {d.passes} {d.passes === 1 ? "pass" : "passes"} on order <strong style={{ color: brand.ink }}>{d.publicId}</strong> for{" "}
          {d.eventTitle}: <strong style={{ color: brand.ink }}>{d.amountText}</strong>. Refunded passes no longer work at the gate.
        </Text>
      )}
      <Text style={p}>{how}</Text>
      {d.kind === "refund" && (
        <Text style={{ ...p, fontSize: "13px" }}>
          Only the ticket price is refundable; the platform fee, organiser charges and tax aren&apos;t. See our{" "}
          <a href={d.policyUrl} style={{ color: brand.orangeStrong }}>
            refund policy
          </a>
          .
        </Text>
      )}
    </Shell>
  );
}
