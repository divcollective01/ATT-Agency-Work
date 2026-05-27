export type TellerTransaction = {
  id: string;
  date: string;
  name: string;
  amount: number;
  category: string;
  merchantName: string | null;
  pfcPrimary: string | null;
  pfcDetailed: string | null;
  bucket: ExpenseCategory;
  customBucket?: ExpenseCategory | null;
};

export type TellerAccount = {
  id: string;
  name: string;
  type: string;
  subtype: string | null;
  balanceCurrent: number | null;
  balanceAvailable: number | null;
};

export type TellerSyncData = {
  transactions: TellerTransaction[];
  accounts: TellerAccount[];
  institutionName: string | null;
};

export type PlaidTransaction = TellerTransaction;
export type PlaidAccount = TellerAccount;
export type PlaidExchangeData = TellerSyncData;

export type ExpenseCategory =
  | "Revenue & Deposits"
  | "Zelle & Peer Payments"
  | "Internal Account Sweeps"
  | "Wires & External Transfers"
  | "Corporate Card Settlements"
  | "Merchant Services & Revenue Processing"
  | "Payroll & Benefits"
  | "Contractor & Freelance Platforms"
  | "Corporate Taxes & Compliance"
  | "Bank Fees & Treasury Services"
  | "Materials & COGS"
  | "Software & SaaS"
  | "Cloud Infrastructure & DevOps"
  | "Enterprise SaaS & Workflow"
  | "Creative Tooling & Production"
  | "Marketing Tools & Automation"
  | "Logistics & Freight"
  | "Marketing & Ads"
  | "Facilities, Rent & Utilities"
  | "Consumer Goods & Big-Box Retail"
  | "Travel, Lodging & Flights"
  | "Ground Transit & Rideshare"
  | "Meals, Dining & Team Perks"
  | "Automotive, Fuel & Fleet"
  | "Office Infrastructure & IT"
  | "Insurance & Risk Management"
  | "Legal & Professional Advisory"
  | "Corporate Subscriptions & Gifts"
  | "Other Operational Overhead";

export const NAMED_BUCKETS = [
  "Revenue & Deposits",
  "Zelle & Peer Payments",
  "Internal Account Sweeps",
  "Wires & External Transfers",
  "Corporate Card Settlements",
  "Merchant Services & Revenue Processing",
  "Payroll & Benefits",
  "Contractor & Freelance Platforms",
  "Corporate Taxes & Compliance",
  "Bank Fees & Treasury Services",
  "Materials & COGS",
  "Software & SaaS",
  "Cloud Infrastructure & DevOps",
  "Enterprise SaaS & Workflow",
  "Creative Tooling & Production",
  "Marketing Tools & Automation",
  "Logistics & Freight",
  "Marketing & Ads",
  "Facilities, Rent & Utilities",
  "Consumer Goods & Big-Box Retail",
  "Travel, Lodging & Flights",
  "Ground Transit & Rideshare",
  "Meals, Dining & Team Perks",
  "Automotive, Fuel & Fleet",
  "Office Infrastructure & IT",
  "Insurance & Risk Management",
  "Legal & Professional Advisory",
  "Corporate Subscriptions & Gifts",
] as const;

export type NamedBucket = (typeof NAMED_BUCKETS)[number];

export const REVENUE_BUCKET: ExpenseCategory = "Revenue & Deposits";
export const FALLBACK_BUCKET: ExpenseCategory = "Other Operational Overhead";
export const CATEGORY_BUCKETS = [...NAMED_BUCKETS, FALLBACK_BUCKET] as const;
export type FallbackBucket = typeof FALLBACK_BUCKET;
export type CorporateBucket = ExpenseCategory;
export type SpendingBucket = ExpenseCategory;

export type MerchantCategoryOverride = {
  merchant_name: string | null;
  description_pattern: string | null;
  custom_bucket: ExpenseCategory;
};

// ── Regex builders ─────────────────────────────────────────────────────────
// Scan text is uppercased before matching; all patterns target [A-Z] only.
//
//   tok(s) — letter-only boundary on both sides (when the relevant edge is a
//            letter). Digits and punctuation count as gaps, so "AWS" matches
//            "AWS#1234" / "AWS92" but rejects "PAWS". Use for acronyms and
//            brand names that must not absorb a longer suffix.
//
//   pre(s) — leading letter boundary only. Use for stems whose suffix varies
//            in real bank text (e.g. "DELTA AIR" → "DELTA AIRLINES").
//
//   wb(s)  — standard \b word boundaries on both sides. \b treats [A-Za-z0-9_]
//            as word chars, so digits also act as separators. Preferred for
//            broad industry vocabulary (RESTAURANT, GAS, INK, BAR, etc.)
//            where the pattern is a real English word and digit adjacency is
//            not expected. Prevents "BARK" from matching "BAR" and "BARBER"
//            from matching "BAR", while "BAR & GRILL" and "THE PUB" still
//            match cleanly.

const REGEX_META = /[.*+?^${}()|[\]\\]/g;

function escapeRe(s: string): string {
  return s.replace(REGEX_META, "\\$&");
}

function tok(s: string): RegExp {
  const t = s.trim();
  const lead = /^[A-Za-z]/.test(t) ? "(?<![A-Z])" : "";
  const trail = /[A-Za-z]$/.test(t) ? "(?![A-Z])" : "";
  return new RegExp(`${lead}${escapeRe(t)}${trail}`);
}

function pre(s: string): RegExp {
  const t = s.trim();
  const lead = /^[A-Za-z]/.test(t) ? "(?<![A-Z])" : "";
  return new RegExp(`${lead}${escapeRe(t)}`);
}

function wb(s: string): RegExp {
  return new RegExp(`\\b${escapeRe(s.trim())}\\b`);
}

// ── BUCKET_RULES ───────────────────────────────────────────────────────────
// First match wins. Ordering is a hard contract:
//   T1 (1-6):   Bank / payment infrastructure. Evaluated before all merchants
//               so bank-system strings don't collide with brand names below.
//   T2 (7-15):  Named SaaS / platform merchants + generic software vocabulary.
//               Named brands precede generic wb() terms within each bucket so
//               a named match always beats a broad keyword. "Software & SaaS"
//               sits last in T2 to act as the generic-software catch-all only
//               after every named SaaS platform has had a chance to match.
//   T3 (16-23): Operational categories with merchant overlap. Named suppliers,
//               carriers, and utilities precede their generic wb() expansions.
//   T4 (24-27): Catch-all retail / consumer / transit. Generic dining vocab
//               lives here so T3 operational terms (DELIVERY, SHIPPING) can
//               still win for true logistics transactions; Meals precedes
//               Ground Transit so "UBER EATS" hits Meals before "UBER" hits
//               Transit.
type BucketRule = {
  readonly bucket: ExpenseCategory;
  readonly patterns: ReadonlyArray<RegExp>;
};

const BUCKET_RULES: ReadonlyArray<BucketRule> = [
  // ── T1: Bank / payment infrastructure ────────────────────────────────────
  { bucket: "Bank Fees & Treasury Services", patterns: [
    tok("SERVICE CHARGE"), tok("ANNUAL FEE"), tok("ANALYSIS FEE"),
    tok("MAINTENANCE FEE"), tok("OVERDRAFT"), tok("INSUFFICIENT FUNDS"),
    tok("STOP PAYMENT"), tok("BANK OF AMERICA"), tok("WELLS FARGO"),
    tok("JPMORGAN"), tok("CHASE"), tok("CAPITAL ONE"), tok("CITIBANK"),
    tok("CITI"), tok("US BANK"), tok("PNC BANK"), tok("TRUIST"),
    tok("TD BANK"), tok("CHARLES SCHWAB"), tok("FIDELITY"),
    tok("NAVY FEDERAL"), tok("PENFED"), tok("BREX"), tok("RAMP"),
    tok("MERCURY"), tok("NOVO"), tok("RELAY"), tok("RHO"),
    tok("FOREIGN TRANSACTION"), tok("INTEREST EXPENSE"),
    tok("CREDIT UNION"), tok("UNION BANK"), tok("FED INT"),
  ] },
  { bucket: "Zelle & Peer Payments", patterns: [
    tok("ZELLE"), tok("PEER TO PEER"), tok("VENMO"), tok("CASH APP"),
    tok("PAYPAL *"), tok("PYPL"),
  ] },
  { bucket: "Internal Account Sweeps", patterns: [
    tok("SWEEP"), tok("INTRACO"), tok("INTERNAL TRANSFER"),
    tok("ONLINE TRANSFER"), tok("ZBA"), tok("BOOK TRANSFER"),
    tok("ACCT XFER"), tok("DEBIT XFER"), tok("ONLINE DEBIT"),
  ] },
  { bucket: "Wires & External Transfers", patterns: [
    tok("FEDWIRE"), tok("WIRE TRANSFER"), tok("DOMESTIC WIRE"),
    tok("INTL WIRE"), tok("REMITLY"), tok("PAYONEER"),
    tok("WESTERN UNION"), tok("XOOM"), tok("WISE.COM"),
    tok("TRANSFERWISE"), tok("CURRENCYFAIR"),
    tok("ACH DEBIT"), tok("DEBIT TRANSFER"), tok("WIRE IN"),
  ] },
  { bucket: "Corporate Card Settlements", patterns: [
    tok("CORP CARD"), tok("CREDIT CARD PMNT"), tok("AMEX EBILL"),
    tok("CHASE CC"), tok("AMERICAN EXPRESS"), tok("DISCOVER"),
    tok("MASTERCARD"),
  ] },
  { bucket: "Corporate Taxes & Compliance", patterns: [
    tok("IRS"), tok("USATAX"), tok("FRANCHISE TAX"),
    tok("DEPT OF REVENUE"), tok("TAX PAYMT"), tok("ESTIMATED TAX"),
    tok("FINCEN"),
    wb("TAX"),
  ] },

  // ── T2: Named SaaS / platform merchants ──────────────────────────────────
  { bucket: "Merchant Services & Revenue Processing", patterns: [
    tok("STRIPE"), tok("SQUARE"), tok("SQ *"), tok("BRAINTREE"),
    tok("AUTHORIZE.NET"), tok("ADYEN"), tok("PADDLE.COM"), tok("GUMROAD"),
    tok("LEMONSQUEEZY"), tok("CLOVER"), tok("TOAST"), tok("SHOPIFY"),
    tok("WOOCOMMERCE"), tok("CHARGEBEE"), tok("RECURLY"),
    tok("GOCARDLESS"), tok("AFFIRM"), tok("KLARNA"), tok("AFTERPAY"),
    tok("SEZZLE"),
  ] },
  { bucket: "Contractor & Freelance Platforms", patterns: [
    tok("UPWORK"), tok("FIVERR"), tok("DEEL"), tok("TOPTAL"),
    tok("GURU.COM"), tok("FREELANCER"), tok("TOPCODER"), tok("GIGSTER"),
    tok("99DESIGNS"),
  ] },
  { bucket: "Payroll & Benefits", patterns: [
    tok("ADP"), tok("GUSTO"), tok("RIPPLING"), tok("TRINET"),
    tok("BAMBOOHR"), tok("WORKDAY"), tok("PAPAYA GLOBAL"), tok("PAYCHEX"),
    tok("PAYLOCITY"), tok("ZENEFITS"), tok("JUSTWORKS"), tok("ONPAY"),
    tok("PAYCOM"), tok("MULTIPLIER"), tok("REMOTE.COM"),
    tok("BLUE CROSS"), tok("BCBS"), tok("AETNA"), tok("CIGNA"),
    tok("HUMANA"), tok("UNITEDHEALTH"), tok("KAISER"), tok("VANGUARD"),
    tok("EMPOWER"), tok("GUIDELINE"),
  ] },
  { bucket: "Cloud Infrastructure & DevOps", patterns: [
    tok("AWS"), tok("AMAZON WEB"), tok("VERCEL"), tok("GITHUB"),
    tok("GOOGLE CLOUD"), tok("GCP"), tok("AZURE"), tok("CLOUDFLARE"),
    tok("DIGITALOCEAN"), tok("LINODE"), tok("RENDER.COM"), tok("NETLIFY"),
    tok("HEROKU"), tok("FLY.IO"), tok("BACKBLAZE"), tok("SUPABASE"),
    tok("SNOWFLAKE"), tok("DATABRICKS"), tok("MONGODB"),
    tok("PLANETSCALE"), tok("COCKROACHDB"), tok("ALGOLIA"),
    tok("PINECONE"), tok("ROUTE53"), tok("GODADDY"), tok("NAMECHEAP"),
    tok("SQUARESPACE"), tok("TWILIO"), tok("SENDGRID"), tok("POSTMARK"),
    tok("MAILGUN"), tok("LOGROCKET"), tok("SENTRY"), tok("DATADOG"),
    tok("NEWRELIC"), tok("PAGERDUTY"), tok("HASHICORP"), tok("OPENAI"),
    tok("ANTHROPIC"), tok("CLAUDE"), tok("HUGGINGFACE"),
    tok("PERPLEXITY"), tok("COHERE"), tok("VULTR"), tok("FASTLY"),
    tok("AKAMAI"), tok("DOCKER"), tok("GITLAB"), tok("BITBUCKET"),
    wb("CLOUD"), wb("HOSTING"),
  ] },
  { bucket: "Enterprise SaaS & Workflow", patterns: [
    tok("SLACK"), tok("ZOOM"), tok("LOOM"), tok("INTERCOM"), tok("MIRO"),
    tok("LUCIDCHART"), tok("FIGMA"), tok("NOTION"), tok("LINEAR"),
    tok("ASANA"), tok("MONDAY.COM"), tok("CLICKUP"), tok("JIRA"),
    tok("ATLASSIAN"), tok("AIRTABLE"), tok("RETOOL"), tok("ZAPIER"),
    tok("MAKE.COM"), tok("TYPEFORM"), tok("SALESFORCE"), tok("HUBSPOT"),
    tok("GSUITE"), tok("GOOGLE WORKSPACE"), tok("MICROSOFT 365"),
    tok("OFFICE 365"), tok("DOCUSIGN"), tok("HELLOSIGN"), tok("PANDADOC"),
    tok("RAYCAST"), tok("ZENDESK"), tok("FRESHDESK"), tok("SERVICENOW"),
    tok("DROPBOX"), tok("BOX.COM"), tok("ZOHO"), tok("CALENDLY"),
    tok("GONG"), tok("OUTREACH"),
    wb("CRM"),
  ] },
  { bucket: "Creative Tooling & Production", patterns: [
    tok("ADOBE"), tok("CANVA"), tok("ENVATO"), tok("SHUTTERSTOCK"),
    tok("MIDJOURNEY"), tok("SKETCH"), tok("SPLICE"), tok("FRAMER"),
    tok("INVISION"), tok("CORELDRAW"), tok("AUTODESK"),
    tok("GETTY IMAGES"), tok("ISTOCK"),
  ] },
  { bucket: "Marketing Tools & Automation", patterns: [
    tok("MAILCHIMP"), tok("KLAVIYO"), tok("ACTIVECAMPAIGN"),
    tok("SEMRUSH"), tok("AHREFS"), tok("HOOTSUITE"), tok("BUFFER"),
    tok("SPROUT SOCIAL"), tok("JASPER.AI"), tok("COPY.AI"),
    tok("DESCRIPT.COM"), tok("VIMEO"), tok("MARKETO"),
    tok("CONSTANT CONTACT"), tok("BRAZE"), tok("ITERABLE"),
  ] },
  { bucket: "Marketing & Ads", patterns: [
    tok("FACEBK"), tok("META ADS"), tok("GOOGLE ADS"), tok("ADWORDS"),
    tok("LINKEDIN ADS"), tok("TWITTER ADS"), tok("TIKTOK ADS"),
    tok("BING ADS"), tok("PINTEREST ADS"), tok("REDDIT ADS"),
    tok("ADROLL"), tok("TABOOLA"), tok("OUTBRAIN"), tok("YELP ADS"),
    tok("APPLE SEARCH ADS"),
    wb("ADVERTISING"), wb("PROMO"), wb("MARKETING"), wb("SPONSOR"),
  ] },
  // Generic software catch-all — evaluated last in T2 so every named SaaS
  // platform above has priority. Only reaches here for unrecognised tools.
  { bucket: "Software & SaaS", patterns: [
    wb("SOFTWARE"), wb("SAAS"), wb("SUBSCRIPTION"),
  ] },

  // ── T3: Operational with merchant overlap ────────────────────────────────
  { bucket: "Materials & COGS", patterns: [
    tok("MCMASTER"), tok("GRAINGER"), tok("DIGIKEY"), tok("MOUSER"),
    tok("HOME DEPOT"), tok("LOWE'S"), tok("LOWES"), tok("ACE HARDWARE"),
    tok("HARBOR FREIGHT"), tok("TRUE VALUE"), tok("MENARDS"),
    tok("FERGUSON"), tok("HD SUPPLY"), tok("ULINE"),
    tok("MSC INDUSTRIAL"), tok("ZORO"), tok("FASTENAL"), tok("WURTH"),
    tok("ARROW ELECTRONICS"), tok("AVNET"), tok("TRACTOR SUPPLY"),
    tok("NORTHERN TOOL"), tok("RYERSON"), tok("AIRGAS"),
    tok("SHERWIN-WILLIAMS"), tok("BUILDERS FIRSTSOURCE"), tok("FASTENERS"),
    wb("SUPPLY"), wb("SUPPLIES"), wb("WHOLESALE"), wb("DISTRIBUTOR"),
    wb("INVENTORY"), pre("RAW MAT"), wb("HARDWARE"), wb("MANUFACTURING"),
  ] },
  { bucket: "Logistics & Freight", patterns: [
    tok("FEDEX"), tok("UPS"), tok("USPS"), tok("DHL"), tok("FLEXPORT"),
    tok("FREIGHTOS"), tok("SHIPSTATION"), tok("PIRATESHIP"),
    tok("STAMPS.COM"), tok("SHIPPIT"), tok("MOO.COM"),
    tok("XPO LOGISTICS"), tok("C.H. ROBINSON"), tok("JB HUNT"),
    tok("OLD DOMINION"), tok("SCHNEIDER"), tok("RYDER"), tok("MAERSK"),
    tok("EXPEDITORS"),
    wb("SHIPPING"), wb("FREIGHT"), wb("CARRIER"), wb("DELIVERY"),
    wb("TRUCKING"), tok("INVOICE COURIER"),
  ] },
  { bucket: "Insurance & Risk Management", patterns: [
    tok("GEICO"), tok("PROGRESSIVE"), tok("HARTFORD"), tok("STATE FARM"),
    tok("ALLSTATE"), tok("CHUBB"), tok("TRAVELERS"),
    tok("LIBERTY MUTUAL"), tok("NATIONWIDE"), tok("FARMERS"),
    tok("HISCOX"), tok("NEXT INSURANCE"), tok("SURE"), tok("POLICYGENIUS"),
    wb("INSURANCE"), tok("BIZINSURE"), tok("PREMIUM PMNT"), wb("INDEMNITY"),
  ] },
  { bucket: "Legal & Professional Advisory", patterns: [
    tok("LEGALZOOM"), tok("ROCKET LAWYER"), tok("CLERKY"),
    tok("STRIPE ATLAS"), tok("EY"), tok("KPMG"), tok("DELOITTE"),
    tok("PWC"), tok("BDO"), tok("BAKER TILLY"), tok("GRANT THORNTON"),
    tok("COOLEY"), tok("FENWICK"),
  ] },
  { bucket: "Travel, Lodging & Flights", patterns: [
    pre("DELTA AIR"), pre("UNITED AIR"), pre("AMERICAN AIR"),
    pre("SOUTHWEST AIR"), tok("JETBLUE"), tok("MARRIOTT"), tok("HILTON"),
    tok("AIRBNB"), tok("EXPEDIA"), pre("ALASKA AIR"), pre("SPIRIT AIR"),
    pre("FRONTIER AIR"), tok("AIR CANADA"), tok("HYATT"), tok("WYNDHAM"),
    tok("IHG"), tok("BOOKING.COM"), tok("PRICELINE"), tok("KAYAK"),
    tok("VRBO"),
    wb("ACCOMMODATION"), wb("LODGING"), wb("HOTEL"), wb("AIRLINE"),
    wb("AIRLINES"), wb("TRAVEL"),
  ] },
  { bucket: "Automotive, Fuel & Fleet", patterns: [
    tok("SHELL OIL"), tok("EXXON"), tok("CHEVRON"), tok("7-ELEVEN"),
    tok("AUTOZONE"), tok("BP"), tok("SPEEDWAY"), tok("PILOT TRAVEL"),
    pre("TESLA SUPER"), tok("SUPERCHARGER"), tok("CHARGEPOINT"),
    tok("EVGO"), tok("HERTZ"), tok("AVIS"), tok("ENTERPRISE RENT"),
    tok("BUDGET-CAR"), tok("VALVOLINE"), tok("SUNOCO"),
    tok("PHILLIPS 66"), tok("WEX"), tok("FLEETCOR"), tok("U-HAUL"),
    tok("PENSKE"), tok("JIFFY LUBE"), tok("O'REILLY AUTO"), tok("PEP BOYS"),
    wb("FUEL"), wb("GASOLINE"), wb("AUTOMOTIVE"),
  ] },
  { bucket: "Office Infrastructure & IT", patterns: [
    tok("APPLE STORE"), tok("DELL"), tok("CDW"), tok("STAPLES"),
    tok("OFFICE DEPOT"), tok("OFFICEMAX"), tok("SHRED-IT"),
    tok("SAMS CLUB"), tok("SAM'S CLUB"), tok("LENOVO"),
    tok("HEWLETT PACKARD"), tok("B&H PHOTO"), tok("MICRO CENTER"),
    tok("IKEA"),
    wb("STATIONERY"), wb("PRINTING"), wb("INK"), wb("TONER"),
    wb("PAPER"), wb("FURNITURE"), wb("OFFICE"), wb("ELECTRONICS"),
  ] },
  { bucket: "Facilities, Rent & Utilities", patterns: [
    tok("WEWORK"), tok("REGUS"), tok("SPACES"), tok("COMCAST"),
    tok("XFINITY"), tok("CHARTER COMM"), tok("SPECTRUM"), tok("COX COMM"),
    tok("ATT BUSI"), tok("AT&T"), tok("VERIZON"), tok("CONED"),
    tok("CON EDISON"), tok("PG&E"), tok("NATIONAL GRID"),
    tok("DUKE ENERGY"), tok("SOUTHERN CO"), tok("WASTE MGMT"),
    tok("REPUBLIC SERV"), tok("T-MOBILE"), tok("SPRINT"),
    tok("CENTURYLINK"),
    wb("RENTAL"), wb("LEASE"), wb("ELECTRIC"), wb("UTILITIES"),
    wb("POWER"), wb("WATER"), wb("GAS"), wb("PROPANE"), wb("SEWER"),
  ] },

  // ── T4: Catch-all retail / consumer / transit ────────────────────────────
  { bucket: "Consumer Goods & Big-Box Retail", patterns: [
    tok("AMZN MKTP"), tok("AMZN"), tok("AMAZON"), tok("WAL-MART"),
    tok("WALMART"), tok("TARGET"), tok("COSTCO"), tok("BEST BUY"),
    tok("EBAY"), tok("BJ'S"), tok("KROGER"), tok("PUBLIX"),
    tok("SAFEWAY"), tok("ALBERTSONS"), tok("MEIJER"), tok("ALDI"),
    tok("HEB"), tok("WEGMANS"), tok("MACY'S"), tok("KOHL'S"),
    wb("SHOPPING"), wb("CLOTHING"), wb("APPAREL"), wb("RETAIL"),
  ] },
  { bucket: "Corporate Subscriptions & Gifts", patterns: [
    tok("LINKEDIN PREMIUM"), tok("HBR"), tok("WALL STREET JOURNAL"),
    tok("NEW YORK TIMES"), tok("NYTIMES"), tok("BLOOMBERG"),
    tok("STATISTA"), tok("STICKERMULE"), tok("PRINTFUL"),
    tok("VISTAPRINT"), tok("PATREON"), tok("SUBSTACK"), tok("MEDIUM"),
    tok("CUSTOM INK"),
    wb("ENTERTAINMENT"), wb("CHARITY"),
  ] },
  // Meals precedes Ground Transit — keeps "UBER EATS" in Meals and generic
  // dining vocab (RESTAURANT, CAFE, etc.) evaluated before "UBER" in Transit.
  { bucket: "Meals, Dining & Team Perks", patterns: [
    tok("STARBUCKS"), tok("SBUX"), tok("DUNKIN"), tok("TIM HORTONS"),
    tok("DUTCH BROS"), tok("PEETS"), tok("CARIBOU"), tok("DOORDASH"),
    tok("UBER EATS"), tok("UBEREATS"), tok("GRUBHUB"), tok("SEAMLESS"),
    tok("INSTACART"), tok("SHIPT"), tok("SWEETGREEN"), tok("CHIPOTLE"),
    tok("PANERA"), tok("AU BON PAIN"), tok("EINSTEIN BROS"),
    tok("WHOLEFOODS"), tok("TRADER JOE"), tok("TST*"), tok("MCDONALDS"),
    tok("BURGER KING"), tok("WENDYS"), tok("TACO BELL"),
    tok("CHICK-FIL-A"), tok("SUBWAY"), tok("DOMINOS"), tok("PIZZA HUT"),
    tok("PAPA JOHNS"), tok("KFC"), tok("SONIC"), tok("DAIRY QUEEN"),
    tok("ARBY'S"), tok("IN-N-OUT"), tok("SHAKE SHACK"), tok("FIVE GUYS"),
    tok("POPEYES"), tok("PANDA EXPRESS"), tok("WINGSTOP"),
    tok("LITTLE CAESARS"), tok("JIMMY JOHNS"), tok("JERSEY MIKES"),
    tok("FIREHOUSE SUBS"), tok("CAVA"),
    wb("RESTAURANT"), wb("DINING"), wb("CAFE"), wb("EATERY"),
    wb("BAR"), wb("GRILL"), wb("FOOD"), wb("BISTRO"), wb("PUB"),
    wb("KITCHEN"), wb("STEAKHOUSE"), wb("BAKERY"), wb("COFFEE"),
    wb("CATERING"), wb("GROCERIES"), wb("GROCERY"),
  ] },
  { bucket: "Ground Transit & Rideshare", patterns: [
    tok("UBER"), tok("LYFT"), tok("MTA"), tok("NYC TRANSIT"),
    tok("METRA"), tok("AMTRAK"), tok("SPOTHERO"), tok("PARKMOBILE"),
    tok("PASSPORT PARKING"), tok("PAYBYPHONE"), tok("E-ZPASS"),
    tok("EZPASS"), tok("E-Z PASS"), tok("SUNPASS"), tok("FASTRAK"),
    tok("BART"), tok("WMATA"), tok("NJ TRANSIT"), tok("SEPTA"),
    tok("MBTA"), tok("DART"),
    wb("TRANSPORT"), wb("TRANSPORTATION"), wb("PARKING"), wb("TAXI"),
  ] },
];

const INFLOW_RULES: readonly RegExp[] = [
  tok("ACH CREDIT"), tok("ACH DEP"), tok("ACH DEPOSIT"),
  tok("CREDIT TRANSFER"), tok("DIRECT DEPOSIT"), tok("ELECTRONIC DEPOSIT"),
  tok("INCOMING ACH"), tok("INCOMING WIRE"), tok("INTEREST CREDIT"),
  tok("INTEREST PAID"), tok("INTERNET BANKING TRANSFER DEPOSIT"),
  tok("MOBILE DEPOSIT"), tok("ONLINE BANKING TRANSFER DEPOSIT"),
  tok("REMOTE DEPOSIT"), tok("TRANSFER DEPOSIT"),
  tok("TRANSFER FROM EXTERNAL"), tok("WIRE CREDIT"), tok("WIRE DEPOSIT"),
  tok("ZELLE DEPOSIT"), tok("ZELLE RECEIVED"), tok("ZELLE CREDIT"),
  tok("REFUND"),
  pre("CREDIT"), pre("CR "), pre("DEP "), pre("DEPOSIT"),
];

export function parseTransactionAmount(
  amount: string | number | null | undefined
): number {
  if (amount === null || amount === undefined) return 0;
  if (typeof amount === "number") return Number.isFinite(amount) ? amount : 0;
  const cleaned = amount.replace(/[^0-9eE+\-.]/g, "");
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export type ClassifiableTxn = {
  name: string;
  category: string;
  amount?: string | number | null;
  bucket?: ExpenseCategory;
  merchantName?: string | null;
  pfcPrimary?: string | null;
  pfcDetailed?: string | null;
  customBucket?: ExpenseCategory | null;
};

// Concatenate the supplied fields into one uppercase, single-spaced scan
// line. Empty/nullish fields drop out. Returns "" when nothing survives.
function joinFields(...fields: ReadonlyArray<string | null | undefined>): string {
  let out = "";
  for (const f of fields) {
    if (f === null || f === undefined) continue;
    const s = f.toString().toUpperCase().trim();
    if (s.length === 0) continue;
    if (out.length > 0) out += " ";
    out += s;
  }
  return out.replace(/\s+/g, " ");
}

function scanRules(text: string): ExpenseCategory | null {
  if (text.length === 0) return null;
  for (const { bucket, patterns } of BUCKET_RULES) {
    for (const pattern of patterns) {
      if (pattern.test(text)) return bucket;
    }
  }
  return null;
}

function normalizeMatcherText(value: string | null | undefined): string {
  return (value ?? "").toUpperCase().replace(/\s+/g, " ").trim();
}

function isKnownBucket(bucket: string | null | undefined): bucket is ExpenseCategory {
  return (CATEGORY_BUCKETS as readonly string[]).includes(bucket ?? "");
}

function scanInflow(text: string): boolean {
  return text.length > 0 && INFLOW_RULES.some((pattern) => pattern.test(text));
}

export function isInflowTransaction(t: ClassifiableTxn): boolean {
  if (t.amount !== undefined && t.amount !== null) {
    const amount = parseTransactionAmount(t.amount);
    if (amount < 0) return true;
    if (amount > 0) return false;
  }

  return (
    scanInflow(joinFields(t.merchantName, t.name)) ||
    scanInflow(joinFields(t.category, t.pfcDetailed, t.pfcPrimary))
  );
}

export function findCategoryOverride(
  t: ClassifiableTxn,
  overrides: readonly MerchantCategoryOverride[] = []
): ExpenseCategory | null {
  const merchant = normalizeMatcherText(t.merchantName);
  const description = normalizeMatcherText(t.name);

  for (const override of overrides) {
    if (!isKnownBucket(override.custom_bucket)) continue;

    const overrideMerchant = normalizeMatcherText(override.merchant_name);
    if (overrideMerchant && merchant && overrideMerchant === merchant) {
      return override.custom_bucket;
    }

    const pattern = normalizeMatcherText(override.description_pattern);
    if (pattern && description && description.includes(pattern)) {
      return override.custom_bucket;
    }
  }

  return null;
}

export function classifyBucket(
  t: ClassifiableTxn,
  overrides: readonly MerchantCategoryOverride[] = []
): ExpenseCategory {
  // User DB overrides take absolute priority — they must be checked before any
  // pre-computed bucket on the transaction object. `t.customBucket` holds only
  // the bucket that was assigned at last sync; if the user has since created an
  // override it would be silently ignored if we returned early here.
  const overrideBucket = findCategoryOverride(t, overrides);
  if (overrideBucket) return overrideBucket;

  // Inflow detection comes next (before regex) so revenue/deposit transactions
  // are never mis-bucketed as expenses.
  if (isInflowTransaction(t)) return REVENUE_BUCKET;

  // Pre-computed bucket on the transaction (set at sync time or by a prior
  // classification pass). Only used as a hint when no override or inflow rule
  // matched — and only when it's a known named bucket (not a stale fallback).
  if (isKnownBucket(t.customBucket)) return t.customBucket;
  if (isKnownBucket(t.bucket)) return t.bucket;

  // Pass 1 — merchant fields only. `merchantName` and the bank's free-text
  // `name` are the authoritative source of who got paid. We never let
  // Teller's coarse `category` taxonomy bleed into this pass; a generic
  // tag like "Hardware Store" must not steal a transaction whose merchant
  // belongs in a more specific bucket.
  const merchantHit = scanRules(joinFields(t.merchantName, t.name));
  if (merchantHit) return merchantHit;

  // Pass 2 — only if the merchant pass found nothing, fall back to the
  // Teller / Plaid category fields. Useful for transactions with no
  // recognisable merchant string but a known category code.
  const categoryHit = scanRules(joinFields(t.category, t.pfcDetailed, t.pfcPrimary));
  if (categoryHit) return categoryHit;

  return FALLBACK_BUCKET;
}

export function isNamedBucket(b: string): b is NamedBucket {
  return (NAMED_BUCKETS as readonly string[]).includes(b);
}

export function isExpenseTransaction(t: ClassifiableTxn): boolean {
  const amount = parseTransactionAmount(t.amount);
  return amount > 0 && classifyBucket(t) !== REVENUE_BUCKET;
}

export function normalizeTransaction(
  t: ClassifiableTxn & { amount: string | number | null | undefined }
): { amount: number; bucket: ExpenseCategory } {
  return {
    amount: parseTransactionAmount(t.amount),
    bucket: classifyBucket(t),
  };
}
