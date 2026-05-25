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

const BUCKET_RULES: ReadonlyArray<readonly [ExpenseCategory, readonly string[]]> = [
  ["Bank Fees & Treasury Services", [
    "SERVICE CHG",
    "ANNUAL FEE",
    "ANALYSIS FEE",
    "WIRE FEE",
    "OVERDRAFT",
    "STOP PAYMENT",
    "MAINTENANCE FEE",
    "INTEREST EXP",
    "FINANCE CHG",
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
  ["Merchant Services & Revenue Processing", [
    "STRIPE",
    "SQUARE",
    "SQ *",
    "PAYPAL",
    "PAYPAL *",
    "SP *",
    "SHOPIFY",
    "ADYEN",
    "MERCHANT FEES",
    "DISCOUNT RATE",
    "CHARGEBACK",
    "POS RET",
  ]],
  ["Contractor & Freelance Platforms", [
    "UPWORK",
    "FIVERR",
    "DEEL",
    "TOPTAL",
    "FREELANCER",
    "OUTSOURCE",
  ]],
  ["Payroll & Benefits", [
    "ADP",
    "GUSTO",
    "RIPPLING",
    "TRINET",
    "PAYROLL",
    "DIR DEP",
    "SALARY",
    "WAGE",
    "HEALTH INS",
    "401K",
    "BENEFITS",
  ]],
  ["Cloud Infrastructure & DevOps", [
    "AWS",
    "AMAZON WEB",
    "VERCEL",
    "GITHUB",
    "GOOGLE CLOUD",
    "GCP",
    "AZURE",
    "SUPABASE",
    "CLOUDFLARE",
    "CLOUDFLARE DNS",
    "DATADOG",
    "DIGITALOCEAN",
    "MONGODB",
    "ROUTE53",
    "GODADDY",
    "NAMECHEAP",
    "NAME.COM",
    "SQUARESPACE",
    "OPENAI",
    "ANTHROPIC",
    "CLAUDE",
    "HUGGINGFACE",
    "PERPLEXITY",
    "COHERE",
  ]],
  ["Enterprise SaaS & Workflow", [
    "SLACK",
    "ZOOM",
    "LOOM",
    "MIRO",
    "LUCIDCHART",
    "SALESFORCE",
    "HUBSPOT",
    "NOTION",
    "LINEAR",
    "ASANA",
    "JIRA",
    "ATLASSIAN",
    "GSUITE",
    "GOOGLE WORK",
    "MICROSOFT 365",
    "OFFICE 365",
    "INTERCOM",
  ]],
  ["Creative Tooling & Production", [
    "ADOBE",
    "FIGMA",
    "CANVA",
    "ENVATO",
    "SHUTTERSTOCK",
    "MIDJOURNEY",
    "SKETCH",
    "SPLICE",
  ]],
  ["Marketing Tools & Automation", [
    "MAILCHIMP",
    "SEMRUSH",
    "AHREFS",
    "KLAVIYO",
    "HOOTSUITE",
    "ACTIVECAMPAIGN",
    "BUFFER",
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
    "MARKETING PROMO",
  ]],
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
    "PRINTFUL",
    "VISTAPRINT",
    "MOO.COM",
  ]],
  ["Insurance & Risk Management", [
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
    "APPLE",
    "DELL",
    "CDW",
    "STAPLES",
    "OFFICE DEPOT",
    "OFFICEMAX",
    "ULINE",
    "PAPER",
    "PRINTER",
    "INK",
    "DESK",
    "SHRED-IT",
    "ACE HARDWARE",
    "TRUE VALUE",
    "HARBOR FREIGHT",
    "MANARDS",
    "SAMS CLUB",
    "SAM'S CLUB",
  ]],
  ["Facilities, Rent & Utilities", [
    "REALTY",
    "PROP MGMT",
    "LANDLORD",
    "RENTAL",
    "COMCAST BUSINESS",
    "ATT BUSI",
    "VERIZON WIRELESS",
    "POWER",
    "UTILITIES",
    "ELECTRIC",
    "WEWORK",
    "REGUS",
    "SPACES",
  ]],
  ["Consumer Goods & Big-Box Retail", [
    "AMZN MKTP",
    "AMZN",
    "AMAZON",
    "WAL-MART",
    "WALMART",
    "TARGET",
    "COSTCO",
    "HOME DEPOT",
    "LOWE'S",
    "LOWES",
    "BEST BUY",
    "EBAY",
  ]],
  ["Corporate Subscriptions & Gifts", [
    "LINKEDIN PREMIUM",
    "HBR",
    "WSJ",
    "CORPORATE GIFTS",
    "STICKERMULE",
  ]],
  ["Meals, Dining & Team Perks", [
    "STARBUCKS",
    "DUNKIN",
    "DOORDASH",
    "UBER EATS",
    "UBEREATS",
    "GRUBHUB",
    "TST*",
    "RESTAURANT",
    "RESTURANT",
    "REST.",
    "EATERY",
    "CAFE",
    "BAKERY",
    "CATERING",
    "SWEETGREEN",
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
    "TIM HORTONS",
    "DUTCH BROS",
    "PEETS",
    "CARIBOU",
    "PANERA",
    "AU BON PAIN",
    "EINSTEIN BROS",
    "INSTACART",
    "SHIPT",
    "WHOLEFOODS",
    "WHOLE FOODS",
  ]],
  ["Ground Transit & Rideshare", [
    "UBER",
    "LYFT",
    "TAXI",
    "CAB ",
    "MTA",
    "AMTRAK",
    "SPOTHERO",
    "PARKING",
    "TOLL",
    "TOLLWAY",
    "E-ZPASS",
    "EZPASS",
    "E-Z PASS",
    "SUNPASS",
    "PARKMOBILE",
    "PASSPORT PARKING",
    "PAYBYPHONE",
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
