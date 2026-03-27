export type SupportedCurrency = "CAD" | "USD";

const COUNTRY_TO_CURRENCY: Record<string, SupportedCurrency> = {
  CA: "CAD",
  US: "USD",
};

const LOCALE_BY_CURRENCY: Record<SupportedCurrency, string> = {
  CAD: "en-CA",
  USD: "en-US",
};

const NUMBER_FORMATTERS: Partial<Record<SupportedCurrency, Intl.NumberFormat>> = {};

function getNumberFormatter(currency: SupportedCurrency): Intl.NumberFormat {
  const cached = NUMBER_FORMATTERS[currency];
  if (cached) return cached;
  const formatter = new Intl.NumberFormat(LOCALE_BY_CURRENCY[currency], {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  NUMBER_FORMATTERS[currency] = formatter;
  return formatter;
}

export function currencyForCountryCode(code: string | undefined | null): SupportedCurrency {
  if (!code) return "CAD";
  return COUNTRY_TO_CURRENCY[code.toUpperCase()] ?? "CAD";
}

export function currencyFromOperatingCountryLabels(
  countries: string[] | undefined
): SupportedCurrency {
  if (!countries?.length) return "CAD";
  for (const c of countries) {
    const label = c.toLowerCase();
    if (label.includes("usa") || label.includes("united states")) return "USD";
    if (label.includes("canada")) return "CAD";
  }
  return "CAD";
}

export type WorkspaceCurrencyFields = {
  operatingCountryCode?: string;
  operatingCountries?: string[];
  preferredCurrency?: string;
};

export function resolveWorkspaceCurrency(
  fields: WorkspaceCurrencyFields | null | undefined
): SupportedCurrency {
  if (!fields) return "CAD";
  // Preferred currency takes priority (user-chosen in Company Profile)
  if (fields.preferredCurrency && isSupportedCurrency(fields.preferredCurrency)) {
    return fields.preferredCurrency;
  }
  if (fields.operatingCountryCode) {
    return currencyForCountryCode(fields.operatingCountryCode);
  }
  return currencyFromOperatingCountryLabels(fields.operatingCountries);
}

function isSupportedCurrency(c: string): c is SupportedCurrency {
  return c === "CAD" || c === "USD" || c === "MXN";
}

export function formatCurrencyAmount(value: number, currency: SupportedCurrency): string {
  // Use Intl for number formatting (grouping + decimals), but override the currency symbol
  // to match the app’s required display rules.
  const symbol = currencySymbol(currency);
  const parts = getNumberFormatter(currency).formatToParts(value);

  return parts
    .map((p) => {
      if (p.type === "currency") return symbol;
      return p.value;
    })
    .join("");
}

export function currencySymbol(currency: SupportedCurrency): string {
  // Required mapping by operating country:
  // - Canada: "CA$"
  // - USA: "$"
  switch (currency) {
    case "CAD":
      return "CA$";
    case "USD":
      return "$";
    default:
      return currency;
  }
}

export function currencyPerLitreLabel(currency: SupportedCurrency): string {
  return `${currencySymbol(currency)}/L`;
}

// ── Exchange rates (base: USD) ─────────────────────────────────────
// These are approximate rates; in production you'd fetch live rates.
// Last updated: March 2026
const EXCHANGE_RATES_TO_USD: Record<SupportedCurrency, number> = {
  USD: 1.0,
  CAD: 0.6944,  // 1 CAD = 0.6944 USD  (1 USD = 1.44 CAD, matches fuelPriceService)
  MXN: 0.058,   // 1 MXN = 0.058 USD
};

/**
 * Convert a monetary value from one currency to another.
 * e.g. convertCurrency(4800, "USD", "CAD") → ~6666.67
 */
export function convertCurrency(
  amount: number,
  from: SupportedCurrency,
  to: SupportedCurrency,
): number {
  if (from === to) return amount;
  // Convert to USD first, then to target
  const inUsd = amount * EXCHANGE_RATES_TO_USD[from];
  return inUsd / EXCHANGE_RATES_TO_USD[to];
}

/**
 * Convert all monetary fields in a cost profile from one currency to another.
 * Non-monetary fields (days, hours, consumption) are left untouched.
 */
export function convertCostProfileCurrency<
  T extends Record<string, unknown>,
>(profile: T, from: SupportedCurrency, to: SupportedCurrency): T {
  if (from === to) return profile;
  const moneyFields = [
    "monthlyTruckPayment",
    "monthlyInsurance",
    "monthlyMaintenance",
    "monthlyPermitsPlates",
    "monthlyOther",
    "driverPayPerHour",
    "driverPayPerMile",
    "detentionRatePerHour",
  ];
  const converted = { ...profile };
  for (const field of moneyFields) {
    if (typeof converted[field] === "number") {
      (converted as Record<string, unknown>)[field] = Math.round(
        convertCurrency(converted[field] as number, from, to) * 100,
      ) / 100;
    }
  }
  return converted;
}

/** Maps wizard/field suffixes that assumed "$" to the user's currency symbol. */
export function localizeMoneySuffix(
  suffix: string | undefined,
  currency: SupportedCurrency
): string | undefined {
  if (!suffix) return undefined;
  const sym = currencySymbol(currency);
  if (suffix === "$") return sym;
  if (suffix === "$/hr") return `${sym}/hr`;
  if (suffix === "$/L") return `${sym}/L`;
  if (suffix === "$/mi") return `${sym}/mi`;
  if (suffix === "$/km") return `${sym}/km`;
  return suffix;
}
