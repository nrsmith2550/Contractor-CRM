import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatDate, formatMoney, humanize } from "@/lib/format";

// Quote PDF. Built from plain data so it is easy to test; uses the standard PDF fonts, so it needs
// no font downloads and works offline. Money is formatted from integer cents.

export type QuotePdfData = {
  currency: string;
  timeZone: string;
  company: { name: string; logoDataUrl: string | null };
  quote: {
    number: string;
    name: string;
    status: string;
    createdAt: Date;
    effectiveTo: string | null;
    paymentTerms: string | null;
    termsText: string | null;
    subtotalCents: number;
    discountCents: number;
    freightCents: number;
    taxCents: number;
    totalCents: number;
  };
  customer: { name: string | null; contact: string | null; addressLines: string[] };
  lines: {
    lineNumber: number;
    description: string;
    quantityMilli: number;
    unitPriceCents: number;
    discountCents: number;
    extendedCents: number;
  }[];
};

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: "#222" },
  row: { flexDirection: "row" },
  between: { flexDirection: "row", justifyContent: "space-between" },
  h1: { fontSize: 20, fontFamily: "Helvetica-Bold" },
  muted: { color: "#666" },
  logo: { height: 44, maxWidth: 160, objectFit: "contain", marginBottom: 6 },
  block: { marginTop: 18 },
  label: { fontSize: 8, color: "#666", textTransform: "uppercase", marginBottom: 2 },
  th: {
    fontFamily: "Helvetica-Bold",
    borderBottomWidth: 1,
    borderBottomColor: "#999",
    paddingVertical: 4,
  },
  td: { paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: "#ddd" },
  cNum: { width: 24 },
  cDesc: { flexGrow: 1, flexBasis: 0 },
  cQty: { width: 44, textAlign: "right" },
  cPrice: { width: 70, textAlign: "right" },
  cDisc: { width: 60, textAlign: "right" },
  cAmt: { width: 76, textAlign: "right" },
  totals: { marginTop: 12, alignSelf: "flex-end", width: 220 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  grand: {
    fontFamily: "Helvetica-Bold",
    fontSize: 12,
    borderTopWidth: 1,
    borderTopColor: "#222",
    marginTop: 4,
    paddingTop: 4,
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    textAlign: "center",
    color: "#888",
    fontSize: 8,
  },
});

export function QuoteDocument({ d }: { d: QuotePdfData }) {
  const m = (c: number) => formatMoney(c, d.currency);
  return (
    <Document title={`${d.quote.number} ${d.quote.name}`} author={d.company.name}>
      <Page size="A4" style={s.page}>
        <View style={s.between}>
          <View>
            {/* react-pdf's Image is not an HTML <img>; it has no alt prop */}
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            {d.company.logoDataUrl && <Image style={s.logo} src={d.company.logoDataUrl} />}
            <Text style={s.h1}>{d.company.name}</Text>
          </View>
          <View style={{ textAlign: "right" }}>
            <Text style={s.h1}>Quote</Text>
            <Text>{d.quote.number}</Text>
            <Text style={s.muted}>{formatDate(d.quote.createdAt, d.timeZone)}</Text>
            {d.quote.effectiveTo && (
              <Text style={s.muted}>Valid until {formatDate(d.quote.effectiveTo, d.timeZone)}</Text>
            )}
            <Text style={s.muted}>{humanize(d.quote.status)}</Text>
          </View>
        </View>

        <View style={s.block}>
          <Text style={s.label}>Prepared for</Text>
          <Text style={{ fontFamily: "Helvetica-Bold" }}>{d.customer.name ?? "—"}</Text>
          {d.customer.contact && <Text>{d.customer.contact}</Text>}
          {d.customer.addressLines.map((l) => (
            <Text key={l}>{l}</Text>
          ))}
        </View>

        <View style={s.block}>
          <Text style={s.label}>Regarding</Text>
          <Text>{d.quote.name}</Text>
        </View>

        <View style={s.block}>
          <View style={[s.row, s.th]}>
            <Text style={s.cNum}>#</Text>
            <Text style={s.cDesc}>Description</Text>
            <Text style={s.cQty}>Qty</Text>
            <Text style={s.cPrice}>Unit price</Text>
            <Text style={s.cDisc}>Discount</Text>
            <Text style={s.cAmt}>Amount</Text>
          </View>
          {d.lines.map((l) => (
            <View key={l.lineNumber} style={[s.row, s.td]} wrap={false}>
              <Text style={s.cNum}>{l.lineNumber}</Text>
              <Text style={s.cDesc}>{l.description}</Text>
              <Text style={s.cQty}>{l.quantityMilli / 1000}</Text>
              <Text style={s.cPrice}>{m(l.unitPriceCents)}</Text>
              <Text style={s.cDisc}>{l.discountCents ? m(l.discountCents) : ""}</Text>
              <Text style={s.cAmt}>{m(l.extendedCents)}</Text>
            </View>
          ))}
        </View>

        <View style={s.totals} wrap={false}>
          <View style={s.totalRow}>
            <Text>Subtotal</Text>
            <Text>{m(d.quote.subtotalCents)}</Text>
          </View>
          {d.quote.discountCents > 0 && (
            <View style={s.totalRow}>
              <Text>Discount</Text>
              <Text>-{m(d.quote.discountCents)}</Text>
            </View>
          )}
          {d.quote.freightCents > 0 && (
            <View style={s.totalRow}>
              <Text>Freight</Text>
              <Text>{m(d.quote.freightCents)}</Text>
            </View>
          )}
          <View style={s.totalRow}>
            <Text>Tax</Text>
            <Text>{m(d.quote.taxCents)}</Text>
          </View>
          <View style={[s.totalRow, s.grand]}>
            <Text>Total</Text>
            <Text>{m(d.quote.totalCents)}</Text>
          </View>
        </View>

        {(d.quote.paymentTerms || d.quote.termsText) && (
          <View style={s.block}>
            {d.quote.paymentTerms && (
              <>
                <Text style={s.label}>Payment terms</Text>
                <Text>{d.quote.paymentTerms}</Text>
              </>
            )}
            {d.quote.termsText && (
              <>
                <Text style={[s.label, { marginTop: 8 }]}>Terms</Text>
                <Text>{d.quote.termsText}</Text>
              </>
            )}
          </View>
        )}

        <Text
          style={s.footer}
          fixed
          render={({ pageNumber, totalPages }) =>
            `${d.quote.number} · Page ${pageNumber} of ${totalPages}`
          }
        />
      </Page>
    </Document>
  );
}

export async function renderQuotePdf(d: QuotePdfData): Promise<Buffer> {
  return renderToBuffer(<QuoteDocument d={d} />);
}
