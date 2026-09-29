/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { brand, formatDateRange } from "./theme";
import type { PassData, TicketsEmailData } from "./types";

// Built-in PDF fonts only, so rendering needs no network or font files.
const s = StyleSheet.create({
  page: { backgroundColor: brand.cream, padding: 22, fontFamily: "Helvetica" },
  card: { backgroundColor: brand.white, borderRadius: 16, overflow: "hidden" },
  header: { backgroundColor: brand.navy, padding: 20 },
  brandRow: { fontSize: 13, fontFamily: "Helvetica-Bold", color: brand.white },
  badge: {
    marginTop: 16,
    alignSelf: "flex-start",
    backgroundColor: brand.yellow,
    color: brand.ink,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.5,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  title: { marginTop: 10, fontSize: 22, fontFamily: "Helvetica-Bold", color: brand.white },
  sub: { marginTop: 6, fontSize: 10, color: brand.onDarkMuted },
  body: { padding: 18, alignItems: "center" },
  typeName: { fontSize: 18, fontFamily: "Helvetica-Bold", color: brand.ink },
  nights: { marginTop: 4, fontSize: 11, color: brand.body },
  nightDate: { marginTop: 8, fontSize: 16, fontFamily: "Helvetica-Bold", letterSpacing: 1, color: brand.orangeStrong },
  qrPanel: { marginTop: 12, padding: 10, borderWidth: 1, borderColor: brand.border, borderRadius: 12 },
  code: { marginTop: 10, fontSize: 10, letterSpacing: 1, color: brand.body },
  meta: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderColor: brand.border, paddingVertical: 12, paddingHorizontal: 18 },
  metaLabel: { fontSize: 8, color: brand.body },
  metaValue: { marginTop: 2, fontSize: 11, fontFamily: "Helvetica-Bold", color: brand.ink },
  foot: { marginTop: 14, fontSize: 8, color: brand.body, textAlign: "center" },
});

function PassPage({ d, t, n }: { d: TicketsEmailData; t: PassData; n: number }) {
  return (
    <Page size="A5" style={s.page} wrap={false}>
      <View style={s.card}>
        <View style={s.header}>
          <Text style={s.brandRow}>
            <Text style={{ color: brand.orangeLight }}>INDINITE</Text>
            {" events"}
          </Text>
          <Text style={s.badge}>{`PASS ${n} OF ${d.tickets.length}`}</Text>
          <Text style={s.title}>{d.event.title}</Text>
          <Text style={s.sub}>{`${formatDateRange(d.event.startsAt, d.event.endsAt)} · ${d.event.venue.name}`}</Text>
        </View>
        <View style={s.body}>
          <Text style={s.typeName}>{t.ticketTypeName}</Text>
          {t.nightDate ? <Text style={s.nightDate}>{t.nightDate}</Text> : <Text style={s.nights}>{t.nightsLabel}</Text>}
          <View style={s.qrPanel}>
            <Image src={{ data: t.qrPng, format: "png" }} style={{ width: 170, height: 170 }} />
          </View>
          <Text style={s.code}>{t.nightDate ? `${t.shortCode} · ${t.nightDate}` : t.shortCode}</Text>
        </View>
        <View style={s.meta}>
          <View>
            <Text style={s.metaLabel}>NAME</Text>
            <Text style={s.metaValue}>{d.customerName}</Text>
          </View>
          <View>
            <Text style={s.metaLabel}>ORDER</Text>
            <Text style={s.metaValue}>{d.publicId}</Text>
          </View>
        </View>
      </View>
      <Text style={s.foot}>
        {`${d.event.venue.name}, ${d.event.venue.address}, ${d.event.venue.postcode}\nThis QR code admits one person and can only be scanned once per night.`}
      </Text>
    </Page>
  );
}

/** One A5 page per ticket. */
/** PDF of `d.tickets` (pass a night's passes for a per-night PDF; `title` names it, e.g. "Sun 11 Oct"). */
export async function renderPassesPdf(d: TicketsEmailData, title?: string): Promise<Buffer> {
  return renderToBuffer(
    <Document title={`${d.event.title} — ${d.publicId}${title ? ` — ${title}` : ""}`} author="Indinite Events">
      {d.tickets.map((t, i) => (
        <PassPage key={t.ticketId} d={d} t={t} n={i + 1} />
      ))}
    </Document>,
  );
}
