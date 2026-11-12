"use client";

import { Button, Card, CardHeader, Text, makeStyles, tokens } from "@fluentui/react-components";
import { TIER_IDS, TIERS, formatUsd } from "@/lib/tiers";
import { startCheckout } from "@/server/actions/billing";

const useStyles = makeStyles({
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: tokens.spacingHorizontalL,
  },
  price: { fontSize: tokens.fontSizeHero800, fontWeight: tokens.fontWeightSemibold },
  form: { marginTop: tokens.spacingVerticalM },
});

export function PricingCards() {
  const styles = useStyles();
  return (
    <div className={styles.grid}>
      {TIER_IDS.map((id) => {
        const t = TIERS[id];
        return (
          <Card key={id}>
            <CardHeader header={<Text weight="semibold">{t.label}</Text>} description={t.seats} />
            <Text className={styles.price}>{formatUsd(t.priceCents)}</Text>
            <Text>One-time payment. Every module included.</Text>
            <form action={startCheckout} className={styles.form}>
              <input type="hidden" name="tier" value={id} />
              <Button appearance="primary" type="submit">
                Buy {t.label}
              </Button>
            </form>
          </Card>
        );
      })}
    </div>
  );
}
