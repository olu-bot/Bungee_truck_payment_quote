export type SupportedCurrency = "CAD" | "USD" | "MXN";

const COUNTRY_TO_CURRENCY: Record<string, SupportedCurrency> = {
  CA: "CAD",
  US: "USD",
  MX: "MXN",
};

const LOCALE_BY_CURRENCY: Record<SupportedCurrency, string> = {
  CAD: "en-CA",
  USD: "en-US",
  MXN: "es-MX",
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
    if (label.includes("mexico")) return "MXN";
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
  // - Mexico: "$Me"
  switch (currency) {
    case "CAD":
      return "CA$";
    case "USD":
      return "$";
    case "MXN":
      return "$Me";
    default:
      return currency;
  }
}

export function currencyPerLitreLabel(currency: SupportedCurrency): string {
  return `${currencySymbol(currency)}/L`;
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
  return suffix;
}
