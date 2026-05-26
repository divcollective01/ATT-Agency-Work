export type TellerTransaction = {
  id: string;
  date: string;
  name: string;
  amount: number;
  category: string;
  merchantName: string | null;
  pfcPrimary: string | null;
  pfcDetailed: string | null;
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

export const FALLBACK_BUCKET: ExpenseCategory = "Other Operational Overhead";
export type FallbackBucket = typeof FALLBACK_BUCKET;
export type CorporateBucket = ExpenseCategory;
export type SpendingBucket = ExpenseCategory;

// BUCKET_RULES — first match wins. Ordering is therefore a hard contract,
// not a stylistic choice. Tier order (top to bottom):
//   T1 (1-6):   Bank / payment infrastructure. Distinctive system descriptors.
//   T2 (7-14):  Named SaaS / platform merchants. Must precede broad retail
//               so AWS hits Cloud and not AMAZON in Consumer Goods.
//   T3 (15-22): Operational categories with merchant overlap.
//   T4 (23-26): Catch-all retail / consumer / transit. Evaluated last so all
//               specifics win. Meals precedes Ground Transit so "UBER EATS"
//               hits Meals instead of "UBER" hitting Transit.
const BUCKET_RULES: ReadonlyArray<readonly [ExpenseCategory, readonly string[]]> = [
  // ───────────────────────── T1: Bank / payment infrastructure ─────────────────────────
  ["Bank Fees & Treasury Services", [
    "SERVICE CHG",
    "ANNUAL FEE",
    "ANALYSIS FEE",
    "RECURRING FEE",
    "CARD FEE",
    "WIRE FEE",
    "WIRE CHG",
    "MAINTENANCE FEE",
    "OVERDRAFT",
    "STOP PAYMENT",
    "STOP PMNT",
    "INSUFFICIENT",
    "NSF",
    "INTEREST EXP",
    "FINANCE CHG",
    "RET RETURNED",
  ]],
  ["Zelle & Peer Payments", [
    "ZELLE",
    "P2P",
    "PEER TO PEER",
    "VENMO",
    "CASH APP",
  ]],
  ["Internal Account Sweeps", [
    "SWEEP",
    "INTRACO",
    "INTERNAL TRANSFER",
    "ONLINE TRANSFER TO",
    "ZBA",
    "BOOK TRANSFER",
    "LIQUIDITY MGMT",
  ]],
  ["Wires & External Transfers", [
    "FEDWIRE",
    "WIRE TRANS",
    "DOMESTIC WIRE",
    "INTL WIRE",
    "FX TRANS",
    "ACH BAL",
    "OUTWARD TRANSFER",
    "CHIPS",
    "CHIPS WIRE",
    "MERCURY WIRE",
    "BREX WIRE",
    "REVOLUT",
    "WISE.COM",          // bare "WISE" collides with "OTHERWISE" etc.
    "TRANSFERWISE",
  ]],
  ["Corporate Card Settlements", [
    "CORP CARD",
    "CREDIT CARD PMNT",
    "AUTOPAY",
    "CARDMEMBER SERV",
    "CC PAYMENT",
    "AMEX EBILL",
    "CHASE CC",
  ]],
  ["Corporate Taxes & Compliance", [
    "IRS",
    "USATAX",
    "STATE TAX",
    "FRANCHISE",
    "TAX REVENUE",
    "ESTIMATED TAX",
    "EFTPS",
    "LEGAL FILING",
    "FINCEN",
  ]],

  // ───────────────────────── T2: Named SaaS / platform merchants ─────────────────────────
  ["Merchant Services & Revenue Processing", [
    "STRIPE",
    "STRIPE*",
    "SQUARE",
    "SQ *",
    "PAYPAL",
    "PAYPAL *",
    "PYPL",
    "SP *",
    "BRAINTREE",
    "AUTHORIZE.NET",
    "ADYEN",
    "PADDLE.COM",        // bare "PADDLE" collides with paddleboard rentals
    "GUMROAD",
    "LEMONSQUEEZY",
    "CLOVER",
    "TOAST",
    "SHOPIFY",
    "WOOCOMMERCE",
    "CHARGEBEE",
    "RECURLY",
    "GOCARDLESS",
    "MERCHANT FEES",
    "DISCOUNT RATE",
    "CHARGEBACK",
    "POS RET",
  ]],
  ["Contractor & Freelance Platforms", [
    "UPWORK",
    "FIVERR",
    "DEEL",              // primary use case; not duplicated in Payroll
    "TOPTAL",
    "GURU.COM",          // bare "GURU" collides with restaurant names
    "FREELANCER",
    "OUTSOURCE",
  ]],
  ["Payroll & Benefits", [
    "ADP",
    "GUSTO",
    "RIPPLING",
    "TRINET",
    "BAMBOOHR",
    "WORKDAY",
    "PAPAYA GLOBAL",     // bare "PAPAYA" collides with grocers
    "PAYCHEX",
    "PAYLOCITY",
    "ZENEFITS",
    "NAVIA",
    "PAYROLL",
    "DIR DEP",
    "SALARY",
    "WAGE",
    "HEALTH INS",
    "BENEFITS",
    // Health insurance carriers — billed at company level, classified
    // as payroll/benefits per spec. Insurance & Risk Management (T3) keeps
    // property/casualty carriers (GEICO, ALLSTATE, etc).
    "BCBS",
    "BLUE CROSS",
    "AETNA",
    "CIGNA",
    "HUMANA",
    "UNITEDHEALTH",
    "KAISER",
    // Retirement contributions through payroll
    "401K",
    "FIDELITY",
    "VANGUARD",
    "EMPOWER",
  ]],
  ["Cloud Infrastructure & DevOps", [
    // IaaS / hosting
    "AWS",
    "AMAZON WEB",        // matches "AMAZON WEB SERVICES" too; precedes Consumer "AMAZON"
    "VERCEL",
    "GITHUB",
    "GOOGLE CLOUD",
    "GCP",
    "AZURE",
    "CLOUDFLARE",
    "CLOUDFLARE DNS",
    "DIGITALOCEAN",
    "LINODE",
    "RENDER.COM",        // bare "RENDER" collides with English
    "NETLIFY",
    "HEROKU",
    "FLY.IO",
    "BACKBLAZE",
    // Data / DB
    "SUPABASE",
    "SNOWFLAKE",
    "DATABRICKS",
    "MONGODB",
    "PLANETSCALE",
    "COCKROACHDB",
    "ALGOLIA",
    "PINECONE",
    // DNS / domains
    "ROUTE53",
    "GODADDY",
    "NAMECHEAP",
    "NAME.COM",
    "SQUARESPACE",
    // Comms / email infra
    "TWILIO",
    "SENDGRID",
    "POSTMARK",
    "MAILGUN",
    "APPSMITH",
    // Observability / ops
    "LOGROCKET",
    "SENTRY",
    "DATADOG",
    "NEWRELIC",
    "NEW RELIC",
    "PAGERDUTY",
    "HASHICORP",         // covers HashiCorp Vault; bare "VAULT" too generic
    // AI APIs
    "OPENAI",
    "ANTHROPIC",
    "CLAUDE",
    "HUGGINGFACE",
    "PERPLEXITY",
    "COHERE",
  ]],
  ["Enterprise SaaS & Workflow", [
    // Comms / meetings
    "SLACK",
    "ZOOM",
    "LOOM",
    "INTERCOM",
    // Whiteboard / docs / design
    "MIRO",
    "LUCIDCHART",
    "FIGMA",             // moved from Creative Tooling per spec
    "NOTION",
    // Project / workflow
    "LINEAR",
    "ASANA",
    "MONDAY.COM",
    "CLICKUP",
    "JIRA",
    "ATLASSIAN",
    "AIRTABLE",
    "RETOOL",
    "ZAPIER",
    "MAKE.COM",          // bare "MAKE" collides with English
    "TYPEFORM",
    // CRM
    "SALESFORCE",
    "HUBSPOT",
    // Productivity suites
    "GSUITE",
    "GOOGLE WORK",
    "GOOGLE WORKSPACE",
    "MICROSOFT 365",
    "M365",
    "OFFICE 365",
    "OFFICE365",
    // E-sign
    "DOCUSIGN",
    "HELLOSIGN",
    "PANDADOC",          // typo fix from PANDAODC
    // Launcher
    "RAYCAST",
  ]],
  ["Creative Tooling & Production", [
    "ADOBE",
    "CANVA",
    "ENVATO",
    "SHUTTERSTOCK",
    "MIDJOURNEY",
    "SKETCH",
    "SPLICE",
  ]],
  ["Marketing Tools & Automation", [
    "MAILCHIMP",
    "KLAVIYO",
    "ACTIVECAMPAIGN",
    "SEMRUSH",
    "AHREFS",
    "HOOTSUITE",
    "BUFFER",
    "SPROUT SOCIAL",
    "JASPER.AI",         // bare "JASPER" collides with restaurant names
    "COPY.AI",
    "DESCRIPT.COM",      // bare "DESCRIPT" matches "DESCRIPTION"
    "VIMEO",
  ]],
  ["Marketing & Ads", [
    "FACEBK",
    "META ADS",
    "GOOGLE ADS",
    "ADWORDS",
    "LINKEDIN ADS",
    "TWITTER ADS",
    "TIKTOK ADS",
    "BING ADS",
    "PINTEREST ADS",
    "REDDIT ADS",
    "ADROLL",
    "TABOOLA",
    "OUTBRAIN",
    "MARKETING PROMO",
  ]],

  // ───────────────────────── T3: Operational with merchant overlap ─────────────────────────
  ["Materials & COGS", [
    "MCMASTER",
    "GRAINGER",
    "SUPPLY",
    "INVENTORY",
    "DISTRIBUTION",
    "RAW MAT",
    "METALS",
    "DIGIKEY",
    "MOUSER",
    "HARDWARE",
    "WAREHOUSE",
    "WHOLESALE",
    "BUILDING MAT",
    "BUILDERS",
    "BUILDER SUPPLY",
    "CONSTRUCTION",
    "CONSTRUCTION MAT",
    "COMPONENT",
    "COMPONENTS",
    "ELECTRICAL SUPPLY",
    "PLUMBING SUPPLY",
    "INDUSTRIAL SUPPLY",
    "JOBSITE",
    "JOB SITE",
    "TRADE SUPPLY",
    "LUMBER",
    "TIMBER",
    "STEEL",
    "STAINLESS",
    "ALUMINUM",
    "COPPER",
    "PVC",
    "PIPE",
    "FITTING",
    "FITTINGS",
    "FASTENER",
    "FASTENERS",
    "ADHESIVE",
    "EPOXY",
    "TOOL CRIB",
    "HOME DEPOT",
    "HOMEDEPOT",
    "LOWE'S",
    "LOWES",
    "ACE HARDWARE",
    "ACE HRDW",
    "HARBOR FREIGHT",
    "TRUE VALUE",
    "MENARDS",
    "MANARDS",
    "FERGUSON",
    "HD SUPPLY",
    "ULINE",
    "MSC INDUSTRIAL",
    "MSC INDUS",
    "ZORO",
    "FASTENAL",
    "WURTH",
    "ARROW ELEC",
    "ARROW ELECTRONICS",
    "AVNET",
    "NEWARK ELEC",
    "ALLIED ELEC",
    "ALLIED ELECTRONICS",
    "TRACTOR SUPPLY",
    "NORTHERN TOOL",
    "RYERSON",
    "AIRGAS",
    "SHERWIN-WILLIAMS",
    "SHERWIN WILLIAMS",
  ]],
  ["Logistics & Freight", [
    "FEDEX",
    "UPS ",
    "USPS",
    "POSTAL",
    "DHL",
    "FREIGHT",
    "SHIPPING",
    "CARRIER",
    "FLEXPORT",
    "FREIGHTOS",
    "SHIPSTATION",
    "PIRATESHIP",
    "STAMPS.COM",
    "STAMPS",
    "SHIPPIT",
    "MOO.COM",
    // PRINTFUL / VISTAPRINT moved to Corporate Subscriptions & Gifts per spec
  ]],
  ["Insurance & Risk Management", [
    // Property / casualty / liability. Health carriers live in Payroll & Benefits.
    "INSURANCE",
    "GEICO",
    "PROGRESSIVE",
    "HARTFORD",
    "STATE FARM",
    "ALLSTATE",
    "MUTUAL",
  ]],
  ["Legal & Professional Advisory", [
    "LEGAL",
    "ATTORNEY",
    "COUNSEL",
    "CPA",
    "ACCOUNTING",
    "CONSULTING",
    "ADVISORY",
    "LAW FIRM",
    "EY ",
    "KPMG",
    "DELOITTE",
    "PWC",
  ]],
  ["Travel, Lodging & Flights", [
    "DELTA",
    "UNITED AIR",
    "AMERICAN AIR",
    "SOUTHWEST",
    "JETBLUE",
    "MARRIOTT",
    "HILTON",
    "AIRBNB",
    "EXPEDIA",
    "CAR RENTAL",
    "HOTEL",
  ]],
  ["Automotive, Fuel & Fleet", [
    "SHELL",
    "EXXON",
    "CHEVRON",
    "7-ELEVEN",
    "7ELEVEN",
    "AUTOZONE",
    "BP ",
    "SPEEDWAY",
    "PILOT TRAVEL",
    "TESLA SUPER",
    "SUPERCHARGER",
    "CHARGEPOINT",
    "EVGO",
    "HERTZ",
    "AVIS",
    "ENTERPRISE RENT",
    "BUDGET-CAR",
  ]],
  ["Office Infrastructure & IT", [
    // Pruned duplicates that lived in Materials & COGS (which fires first):
    // ULINE, ACE HARDWARE, TRUE VALUE, HARBOR FREIGHT, MANARDS — all dead here.
    "APPLE",
    "DELL",
    "CDW",
    "STAPLES",
    "OFFICE DEPOT",
    "OFFICEMAX",
    "PAPER",
    "PRINTER",
    "INK",
    "DESK",
    "SHRED-IT",
    "SAMS CLUB",
    "SAM'S CLUB",
  ]],
  ["Facilities, Rent & Utilities", [
    // Real estate
    "REALTY",
    "PROP MGMT",
    "LANDLORD",
    "RENTAL",
    "WEWORK",
    "REGUS",
    "SPACES",
    // Telco
    "COMCAST BUSINESS",
    "COMCAST",
    "XFINITY",
    "CHARTER",
    "SPECTRUM",
    "COX COMM",
    "ATT BUSI",
    "AT&T",              // raw match preserves "&"; loose pass would strip
    "VERIZON WIRELESS",
    "VERIZON WIRE",
    // Power / utility
    "CONED",
    "CON EDISON",
    "PG&E",
    "PGE",
    "NATIONAL GRID",
    "DUKE ENERGY",
    "SOUTHERN CO",
    "POWER",
    "UTILITIES",
    "ELECTRIC",
    // Waste
    "WASTE MGMT",
    "REPUBLIC SERV",
  ]],

  // ───────────────────────── T4: Catch-all retail / consumer / transit ─────────────────────────
  ["Consumer Goods & Big-Box Retail", [
    // HOME DEPOT, LOWE'S, LOWES pruned — fire in Materials & COGS first
    "AMZN MKTP",
    "AMZN",
    "AMAZON",
    "WAL-MART",
    "WALMART",
    "TARGET",
    "COSTCO",
    "BEST BUY",
    "EBAY",
  ]],
  ["Corporate Subscriptions & Gifts", [
    "LINKEDIN PREMIUM",  // matches "LINKEDIN PREM" too via substring
    "HBR",
    "WSJ",
    "NEW YORK TIMES",
    "NYTIMES",
    "BLOOMBERG",
    "STATISTA",
    "CORPORATE GIFTS",
    "STICKERMULE",
    "PRINTFUL",          // moved from Logistics per spec
    "VISTAPRINT",        // moved from Logistics per spec
  ]],
  ["Meals, Dining & Team Perks", [
    // Coffee
    "STARBUCKS",
    "SBUX",
    "DUNKIN",
    "TIM HORTONS",
    "DUTCH BROS",
    "PEETS",
    "CARIBOU",
    // Delivery / grocery
    "DOORDASH",
    "UBER EATS",         // MUST precede Ground Transit "UBER"
    "UBEREATS",
    "GRUBHUB",
    "SEAMLESS",
    "INSTACART",
    "SHIPT",
    // Chains
    "SWEETGREEN",
    "CHIPOTLE",
    "PANERA",
    "AU BON PAIN",
    "EINSTEIN BROS",
    "WHOLEFOODS",
    "WHOLE FOODS",
    "TRADER JOE",
    // POS prefixes
    "TST*",
    // Generic descriptors
    "RESTAURANT",
    "RESTURANT",
    "REST.",
    "EATERY",
    "CAFE",
    "BAKERY",
    "CATERING",
    "BAR ",
    "GRILL",
    "PUB ",
    "BREWERY",
    "STEAKHOUSE",
    "DAPHISE",
    "DONUT",
    "DELI",
    "DINER",
    "PIZZERIA",
    "SUSHI",
  ]],
  ["Ground Transit & Rideshare", [
    "UBER",              // bare; UBER EATS already handled above in Meals
    "LYFT",
    "TAXI",
    "CAB ",
    "MTA",
    "NYC TRANSIT",
    "METRA",
    "AMTRAK",
    "SPOTHERO",
    "PARKMOBILE",
    "PASSPORT PARKING",
    "PAYBYPHONE",
    "PARKING",
    "TOLL",
    "TOLLWAY",
    "E-ZPASS",
    "EZPASS",
    "E-Z PASS",
    "SUNPASS",
    "FASTRAK",
  ]],
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
  merchantName?: string | null;
  pfcPrimary?: string | null;
  pfcDetailed?: string | null;
};

function buildScanText(t: ClassifiableTxn): { raw: string; loose: string } {
  const parts = [t.merchantName, t.name, t.category, t.pfcDetailed, t.pfcPrimary]
    .map((s) => (s ?? "").toString())
    .filter((s) => s.length > 0);
  const raw = parts.join(" ").toUpperCase().replace(/\s+/g, " ").trim();
  // Loose pass strips digits and non-essential punctuation so noisy bank
  // strings ("REST 1234#NYC*72") still hit clean alpha tokens like "REST."
  // or "EATERY". Apostrophes are preserved for tokens like "LOWE'S".
  const loose = raw
    .replace(/[^A-Z' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { raw, loose };
}

export function classifyBucket(t: ClassifiableTxn): ExpenseCategory {
  const { raw, loose } = buildScanText(t);
  if (!raw) return FALLBACK_BUCKET;

  for (const [bucket, tokens] of BUCKET_RULES) {
    for (const token of tokens) {
      if (raw.includes(token)) return bucket;
      if (loose.includes(token)) return bucket;
    }
  }
  return FALLBACK_BUCKET;
}

export function isNamedBucket(b: string): b is NamedBucket {
  return (NAMED_BUCKETS as readonly string[]).includes(b);
}

export function normalizeTransaction(
  t: ClassifiableTxn & { amount: string | number | null | undefined }
): { amount: number; bucket: ExpenseCategory } {
  return {
    amount: parseTransactionAmount(t.amount),
    bucket: classifyBucket(t),
  };
}
