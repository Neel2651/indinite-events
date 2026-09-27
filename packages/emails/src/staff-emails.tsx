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
