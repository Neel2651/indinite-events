/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { Body, Button, Column, Container, Head, Heading, Hr, Html, Img, Preview, Row, Section, Text } from "@react-email/components";
import { bodyFontStack, brand, fontStack, formatDateRange, price } from "./theme";
import type { TicketsEmailData } from "./types";

const h = { fontFamily: fontStack, color: brand.ink, margin: 0 } as const;
const p = { fontFamily: bodyFontStack, color: brand.body, fontSize: "15px", lineHeight: "24px", margin: "0 0 12px" } as const;

export function subjectFor(d: TicketsEmailData) {
  return d.reason === "resend" ? `Your passes for ${d.event.title} (${d.publicId})` : `You're going! Your passes for ${d.event.title}`;
}

export function TicketsEmail(d: TicketsEmailData) {
  const passes = d.tickets.length;
  return (
    <Html lang="en-GB">
      <Head />
      <Preview>
        {`${passes} ${passes === 1 ? "pass" : "passes"} for ${d.event.title} · order ${d.publicId}`}
      </Preview>
      <Body style={{ backgroundColor: brand.cream, margin: 0, padding: "24px 0" }}>
        <Container style={{ maxWidth: "600px", backgroundColor: brand.white, borderRadius: "20px", overflow: "hidden" }}>
          <Section style={{ backgroundColor: brand.navy, padding: "32px 32px 28px" }}>
            <Text style={{ ...h, color: brand.white, fontSize: "18px", fontWeight: 700, letterSpacing: "0.5px" }}>
              <span style={{ color: brand.orangeLight }}>INDINITE</span> events
            </Text>
            <Text
              style={{
                display: "inline-block",
                margin: "20px 0 0",
                padding: "4px 14px",
                borderRadius: "999px",
                backgroundColor: brand.yellow,
                color: brand.ink,
                fontFamily: bodyFontStack,
                fontSize: "11px",
                fontWeight: 700,
                letterSpacing: "2px",
              }}
            >
              {d.reason === "resend" ? "YOUR PASSES" : "BOOKING CONFIRMED"}
            </Text>
            <Heading as="h1" style={{ ...h, color: brand.white, fontSize: "28px", lineHeight: "36px", marginTop: "14px" }}>
              {d.event.title}
            </Heading>
            <Text style={{ ...p, color: brand.onDarkMuted, margin: "8px 0 0" }}>
              {formatDateRange(d.event.startsAt, d.event.endsAt)} · {d.event.venue.name}, {d.event.venue.postcode}
            </Text>
          </Section>

          <Section style={{ padding: "28px 32px 8px" }}>
            <Text style={p}>Hi {d.customerName.split(" ")[0]},</Text>
            <Text style={p}>
              {d.reason === "resend"
                ? "Here are your passes again."
                : `Thanks for booking. Your ${passes === 1 ? "pass is" : `${passes} passes are`} below and attached as PDFs.`}{" "}
              Show one QR code per person at the gate. You can show it on your phone or print it.
            </Text>
            {d.demo && (
              <Text style={{ ...p, backgroundColor: brand.cream, borderRadius: "10px", padding: "10px 14px" }}>
                Demo booking: no payment was taken.
              </Text>
            )}
          </Section>

          <Section style={{ padding: "0 32px" }}>
            <Text style={{ ...p, margin: "0 0 4px", fontSize: "13px" }}>Order reference</Text>
            <Text style={{ ...h, fontSize: "24px", letterSpacing: "2px", marginBottom: "16px" }}>{d.publicId}</Text>
            {d.lines.map((l) => (
              <Row key={l.label} style={{ borderTop: `1px solid ${brand.border}` }}>
                <Column style={{ padding: "10px 0" }}>
                  <Text style={{ ...p, margin: 0, color: l.negative ? brand.body : brand.ink }}>{l.label}</Text>
                </Column>
                <Column align="right">
                  <Text style={{ ...p, margin: 0, color: l.negative ? brand.body : brand.ink }}>
                    {l.negative ? "−" : ""}
                    {price(l.amountPence)}
                  </Text>
                </Column>
              </Row>
            ))}
            <Row style={{ borderTop: `1px solid ${brand.border}`, borderBottom: `1px solid ${brand.border}` }}>
              <Column style={{ padding: "12px 0" }}>
                <Text style={{ ...h, fontSize: "16px" }}>Total</Text>
              </Column>
              <Column align="right">
                <Text style={{ ...h, fontSize: "16px" }}>{price(d.totalPence)}</Text>
              </Column>
            </Row>
          </Section>

          <Section style={{ padding: "24px 32px 0", textAlign: "center" }}>
            <Button
              href={d.viewUrl}
              style={{
                backgroundColor: brand.orange,
                color: brand.white,
                fontFamily: fontStack,
                fontWeight: 700,
                fontSize: "15px",
                padding: "14px 28px",
                borderRadius: "999px",
              }}
            >
              View tickets online
            </Button>
            <Text style={{ ...p, fontSize: "12px", marginTop: "10px" }}>
              This link works for 30 minutes. Need a new one? Use &ldquo;Find my tickets&rdquo; on our website.
            </Text>
          </Section>

          <Section style={{ padding: "8px 32px 16px" }}>
            {d.tickets.map((t, i) => (
              <Section
                key={t.ticketId}
                style={{
                  backgroundColor: brand.navy,
                  borderRadius: "16px",
                  padding: "20px",
                  marginTop: "16px",
                  textAlign: "center",
                }}
              >
                <Text style={{ ...h, color: brand.white, fontSize: "16px" }}>{t.ticketTypeName}</Text>
                <Text style={{ ...p, color: brand.onDarkMuted, fontSize: "13px", margin: "2px 0 14px" }}>
                  {t.nightsLabel} · Pass {i + 1} of {passes}
                </Text>
                <div style={{ backgroundColor: brand.white, borderRadius: "12px", padding: "16px", display: "inline-block" }}>
                  <Img src={`cid:${t.qrContentId}`} width="200" height="200" alt={`QR code for pass ${i + 1}`} />
                </div>
                <Text style={{ ...p, color: brand.onDarkMuted, fontSize: "12px", margin: "12px 0 0", letterSpacing: "1px" }}>
                  {t.shortCode}
                </Text>
              </Section>
            ))}
          </Section>

          <Hr style={{ borderColor: brand.border, margin: "8px 32px" }} />
          <Section style={{ padding: "8px 32px 28px" }}>
            <Text style={{ ...p, fontSize: "12px", lineHeight: "18px" }}>
              {d.event.venue.name}, {d.event.venue.address}, {d.event.venue.postcode}
              <br />
              Tickets sold by Indinite on behalf of the event organiser. Each QR code admits one person and can only be
              scanned once per night.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
