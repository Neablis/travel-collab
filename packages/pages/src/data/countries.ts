// What a traveller needs to know on arrival, per country — the table behind
// "Know before you go" (M14 link 11).
//
// **Bundled, not fetched** (widget brainstorm, tier B): these facts change about
// once a decade, and a table we own cannot be wrong at render time or down when
// a page opens. The M14 default this implements: *"compiled into the repo from
// public-domain facts … with every source named in the file"*. So:
//
// Sources, per field:
// - `callingCode`, `drives`: the CIA World Factbook (public domain, US
//   government work) — "Communications: country code" and "Transportation:
//   roadways". Calling codes cross-checked against the glibc locale data's
//   `LC_TELEPHONE int_prefix` (LGPL data, used only as a check).
// - `currencies`: ISO 4217, code and English name (`CURRENCY_NAMES` below).
//   Cross-checked against glibc's `LC_MONETARY int_curr_symbol`.
// - `plugs`, `volts`, `hertz`: IEC World Plugs (the IEC's public listing of
//   plug types, voltage and frequency by country), letter types A–O.
// - `emergency`: each country's published emergency numbers, general number
//   first, then police, ambulance, fire. EU/EEA members always carry 112
//   (Universal Service Directive, now the EECC art. 109). **`null` where the
//   compiler was not sure**, which renders as "—": a wrong emergency number is
//   worse than an honest blank, and the gap is a prompt to look it up.
// - `tipping`: deliberately short and conservative, from widely published
//   guidance. `null` by default; set only where the norm is well known.
//
// **Compiled offline from stable public facts, not scraped**, so it can carry an
// error. `countries.test.ts` pins a sample of well-known values and the
// structure of every row; a correction is a one-line edit here.
//
// Keyed by ISO 3166-1 alpha-2, uppercase — the spelling `Location.countryCode`
// stores. Every assigned code a trip can stop in is here; the uninhabited ones
// (AQ, BV, GS, HM, IO, TF) are not, and a stop there renders no card rather
// than an invented one. `XK` (Kosovo) is a user-assigned code rather than an
// ISO one, and is here because geocoders return it.

/** IEC plug type letters. */
export type PlugType = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K" | "L" | "M" | "N" | "O";

export interface CountryFacts {
  name: string;
  plugs: readonly PlugType[];
  /** Mains voltage(s), most common first. Brazil is two: 127 and 220. */
  volts: readonly number[];
  /** Mains frequency. Japan is both: 50 Hz east, 60 Hz west. */
  hertz: readonly (50 | 60)[];
  drives: "left" | "right";
  /** General number first, then police, ambulance, fire. `null` = not sure. */
  emergency: readonly string[] | null;
  /** ISO 4217 codes, the one to carry first. */
  currencies: readonly string[];
  /** With the plus: "+81". NANP members are all "+1". */
  callingCode: string;
  /** Short and conservative; `null` = not sure. */
  tipping: string | null;
}

/** ISO 4217 English names, for every code a row below names. */
export const CURRENCY_NAMES: Readonly<Record<string, string>> = {
  AED: "UAE dirham", AFN: "Afghani", ALL: "Lek", AMD: "Armenian dram", AOA: "Kwanza",
  ARS: "Argentine peso", AUD: "Australian dollar", AWG: "Aruban florin", AZN: "Azerbaijan manat",
  BAM: "Convertible mark", BBD: "Barbados dollar", BDT: "Taka", BHD: "Bahraini dinar",
  BIF: "Burundi franc", BMD: "Bermudian dollar", BND: "Brunei dollar", BOB: "Boliviano",
  BRL: "Brazilian real", BSD: "Bahamian dollar", BTN: "Ngultrum", BWP: "Pula",
  BYN: "Belarusian ruble", BZD: "Belize dollar", CAD: "Canadian dollar", CDF: "Congolese franc",
  CHF: "Swiss franc", CLP: "Chilean peso", CNY: "Yuan renminbi", COP: "Colombian peso",
  CRC: "Costa Rican colon", CUP: "Cuban peso", CVE: "Cabo Verde escudo", CZK: "Czech koruna",
  DJF: "Djibouti franc", DKK: "Danish krone", DOP: "Dominican peso", DZD: "Algerian dinar",
  EGP: "Egyptian pound", ERN: "Nakfa", ETB: "Ethiopian birr", EUR: "Euro",
  FJD: "Fiji dollar", FKP: "Falkland Islands pound", GBP: "Pound sterling", GEL: "Lari",
  GHS: "Ghana cedi", GIP: "Gibraltar pound", GMD: "Dalasi", GNF: "Guinean franc",
  GTQ: "Quetzal", GYD: "Guyana dollar", HKD: "Hong Kong dollar", HNL: "Lempira",
  HTG: "Gourde", HUF: "Forint", IDR: "Rupiah", ILS: "New Israeli sheqel",
  INR: "Indian rupee", IQD: "Iraqi dinar", IRR: "Iranian rial", ISK: "Iceland krona",
  JMD: "Jamaican dollar", JOD: "Jordanian dinar", JPY: "Yen", KES: "Kenyan shilling",
  KGS: "Som", KHR: "Riel", KMF: "Comorian franc", KPW: "North Korean won",
  KRW: "Won", KWD: "Kuwaiti dinar", KYD: "Cayman Islands dollar", KZT: "Tenge",
  LAK: "Lao kip", LBP: "Lebanese pound", LKR: "Sri Lanka rupee", LRD: "Liberian dollar",
  LSL: "Loti", LYD: "Libyan dinar", MAD: "Moroccan dirham", MDL: "Moldovan leu",
  MGA: "Malagasy ariary", MKD: "Denar", MMK: "Kyat", MNT: "Tugrik",
  MOP: "Pataca", MRU: "Ouguiya", MUR: "Mauritius rupee", MVR: "Rufiyaa",
  MWK: "Malawi kwacha", MXN: "Mexican peso", MYR: "Malaysian ringgit", MZN: "Mozambique metical",
  NAD: "Namibia dollar", NGN: "Naira", NIO: "Cordoba oro", NOK: "Norwegian krone",
  NPR: "Nepalese rupee", NZD: "New Zealand dollar", OMR: "Rial Omani", PAB: "Balboa",
  PEN: "Sol", PGK: "Kina", PHP: "Philippine peso", PKR: "Pakistan rupee",
  PLN: "Zloty", PYG: "Guarani", QAR: "Qatari rial", RON: "Romanian leu",
  RSD: "Serbian dinar", RUB: "Russian ruble", RWF: "Rwanda franc", SAR: "Saudi riyal",
  SBD: "Solomon Islands dollar", SCR: "Seychelles rupee", SDG: "Sudanese pound", SEK: "Swedish krona",
  SGD: "Singapore dollar", SHP: "Saint Helena pound", SLE: "Leone", SOS: "Somali shilling",
  SRD: "Surinam dollar", SSP: "South Sudanese pound", STN: "Dobra", SYP: "Syrian pound",
  SZL: "Lilangeni", THB: "Baht", TJS: "Somoni", TMT: "Turkmenistan new manat",
  TND: "Tunisian dinar", TOP: "Pa'anga", TRY: "Turkish lira", TTD: "Trinidad and Tobago dollar",
  TWD: "New Taiwan dollar", TZS: "Tanzanian shilling", UAH: "Hryvnia", UGX: "Uganda shilling",
  USD: "US dollar", UYU: "Peso uruguayo", UZS: "Uzbekistan sum", VES: "Bolivar soberano",
  VND: "Dong", VUV: "Vatu", WST: "Tala", XAF: "CFA franc BEAC",
  XCD: "East Caribbean dollar", XCG: "Caribbean guilder", XOF: "CFA franc BCEAO", XPF: "CFP franc",
  YER: "Yemeni rial", ZAR: "Rand", ZMW: "Zambian kwacha", ZWG: "Zimbabwe gold",
};

// One row per country, positional so ~240 of them stay readable as a table:
//
//   [name, plugs, volts, hertz, drives, emergency, currencies, calling code, tipping]
//
// Space-separated lists, "L"/"R" for the driving side, `null` for "not sure".
// `row` below turns each into a `CountryFacts`; the test checks every field.
type Row = readonly [string, string, string, string, "L" | "R", string | null, string, string, string | null];

// Tipping strings reused often enough to name.
const NONE = "Not expected";
const ROUND = "Round up";
const SERVICE_IN = "Service included; round up";

const ROWS: Readonly<Record<string, Row>> = {
  // ---- Europe ---------------------------------------------------------------
  AD: ["Andorra", "C F", "230", "50", "R", "112 110", "EUR", "376", null],
  AL: ["Albania", "C F", "230", "50", "R", "129 127 128", "ALL", "355", null],
  AT: ["Austria", "C F", "230", "50", "R", "112 133 144 122", "EUR", "43", "Round up 5–10%"],
  AX: ["Åland Islands", "C F", "230", "50", "R", "112", "EUR", "358", null],
  BA: ["Bosnia and Herzegovina", "C F", "230", "50", "R", "122 124 123", "BAM", "387", null],
  BE: ["Belgium", "C E", "230", "50", "R", "112 101", "EUR", "32", SERVICE_IN],
  BG: ["Bulgaria", "C F", "230", "50", "R", "112", "EUR", "359", null],
  BY: ["Belarus", "C F", "230", "50", "R", "102 103 101", "BYN", "375", null],
  CH: ["Switzerland", "C J", "230", "50", "R", "112 117 144 118", "CHF", "41", SERVICE_IN],
  CY: ["Cyprus", "G", "230", "50", "L", "112 199", "EUR", "357", null],
  CZ: ["Czechia", "C E", "230", "50", "R", "112 158 155 150", "CZK", "420", null],
  DE: ["Germany", "C F", "230", "50", "R", "112 110", "EUR", "49", "Round up 5–10%"],
  DK: ["Denmark", "C E F K", "230", "50", "R", "112", "DKK", "45", "Service included"],
  EE: ["Estonia", "C F", "230", "50", "R", "112", "EUR", "372", null],
  ES: ["Spain", "C F", "230", "50", "R", "112", "EUR", "34", "Optional; round up"],
  FI: ["Finland", "C F", "230", "50", "R", "112", "EUR", "358", NONE],
  FO: ["Faroe Islands", "C E F K", "230", "50", "R", "112", "DKK", "298", null],
  FR: ["France", "C E", "230", "50", "R", "112 17 15 18", "EUR", "33", SERVICE_IN],
  GB: ["United Kingdom", "G", "230", "50", "L", "999 112", "GBP", "44", "10–12.5% if no service charge"],
  GG: ["Guernsey", "G", "230", "50", "L", "999 112", "GBP", "44", null],
  GI: ["Gibraltar", "C G", "230", "50", "R", "112 999", "GIP", "350", null],
  GL: ["Greenland", "C E F K", "230", "50", "R", "112", "DKK", "299", null],
  GR: ["Greece", "C F", "230", "50", "R", "112 100 166 199", "EUR", "30", null],
  HR: ["Croatia", "C F", "230", "50", "R", "112", "EUR", "385", null],
  HU: ["Hungary", "C F", "230", "50", "R", "112", "HUF", "36", null],
  IE: ["Ireland", "G", "230", "50", "L", "112 999", "EUR", "353", "10–15% for table service"],
  IM: ["Isle of Man", "G", "230", "50", "L", "999 112", "GBP", "44", null],
  IS: ["Iceland", "C F", "230", "50", "R", "112", "ISK", "354", NONE],
  IT: ["Italy", "C F L", "230", "50", "R", "112 113 118 115", "EUR", "39", "Not expected; round up"],
  JE: ["Jersey", "G", "230", "50", "L", "999 112", "GBP", "44", null],
  LI: ["Liechtenstein", "C J", "230", "50", "R", "112 117 144 118", "CHF", "423", null],
  LT: ["Lithuania", "C F", "230", "50", "R", "112", "EUR", "370", null],
  LU: ["Luxembourg", "C F", "230", "50", "R", "112 113", "EUR", "352", null],
  LV: ["Latvia", "C F", "230", "50", "R", "112", "EUR", "371", null],
  MC: ["Monaco", "C D E F", "230", "50", "R", "112 17 18", "EUR", "377", null],
  MD: ["Moldova", "C F", "230", "50", "R", "112", "MDL", "373", null],
  ME: ["Montenegro", "C F", "230", "50", "R", "112 122 124 123", "EUR", "382", null],
  MK: ["North Macedonia", "C F", "230", "50", "R", "112 192 194 193", "MKD", "389", null],
  MT: ["Malta", "G", "230", "50", "L", "112", "EUR", "356", null],
  NL: ["Netherlands", "C F", "230", "50", "R", "112", "EUR", "31", ROUND],
  NO: ["Norway", "C F", "230", "50", "R", "112 113 110", "NOK", "47", NONE],
  PL: ["Poland", "C E", "230", "50", "R", "112 997 999 998", "PLN", "48", null],
  PT: ["Portugal", "C F", "230", "50", "R", "112", "EUR", "351", null],
  RO: ["Romania", "C F", "230", "50", "R", "112", "RON", "40", null],
  RS: ["Serbia", "C F", "230", "50", "R", "192 194 193", "RSD", "381", null],
  RU: ["Russia", "C F", "230", "50", "R", "112 102 103 101", "RUB", "7", null],
  SE: ["Sweden", "C F", "230", "50", "R", "112", "SEK", "46", NONE],
  SI: ["Slovenia", "C F", "230", "50", "R", "112 113", "EUR", "386", null],
  SK: ["Slovakia", "C E", "230", "50", "R", "112 158 155 150", "EUR", "421", null],
  SJ: ["Svalbard and Jan Mayen", "C F", "230", "50", "R", "112", "NOK", "47", null],
  SM: ["San Marino", "C F L", "230", "50", "R", "112 113 118 115", "EUR", "378", null],
  UA: ["Ukraine", "C F", "230", "50", "R", "112 102 103 101", "UAH", "380", null],
  VA: ["Vatican City", "C F L", "230", "50", "R", "112", "EUR", "39", null],
  XK: ["Kosovo", "C F", "230", "50", "R", "112 192 194 193", "EUR", "383", null],
  // ---- Caucasus, Central Asia, Turkey -------------------------------------
  AM: ["Armenia", "C F", "230", "50", "R", "112", "AMD", "374", null],
  AZ: ["Azerbaijan", "C F", "220", "50", "R", "112 102 103 101", "AZN", "994", null],
  GE: ["Georgia", "C F", "220", "50", "R", "112", "GEL", "995", null],
  KG: ["Kyrgyzstan", "C F", "220", "50", "R", "102 103 101", "KGS", "996", null],
  KZ: ["Kazakhstan", "C F", "220", "50", "R", "112 102 103 101", "KZT", "7", null],
  TJ: ["Tajikistan", "C F", "220", "50", "R", "102 103 101", "TJS", "992", null],
  TM: ["Turkmenistan", "C F", "220", "50", "R", null, "TMT", "993", null],
  TR: ["Türkiye", "C F", "230", "50", "R", "112", "TRY", "90", "~10% at restaurants"],
  UZ: ["Uzbekistan", "C F", "220", "50", "R", "102 103 101", "UZS", "998", null],
  // ---- Middle East --------------------------------------------------------
  AE: ["United Arab Emirates", "C D G", "230", "50", "R", "999 998 997", "AED", "971", null],
  BH: ["Bahrain", "G", "230", "50", "R", "999", "BHD", "973", null],
  EG: ["Egypt", "C F", "220", "50", "R", "122 123 180", "EGP", "20", null],
  IL: ["Israel", "C H", "230", "50", "R", "100 101 102", "ILS", "972", null],
  IQ: ["Iraq", "C D G", "230", "50", "R", null, "IQD", "964", null],
  IR: ["Iran", "C F", "220", "50", "R", "110 115 125", "IRR", "98", null],
  JO: ["Jordan", "B C D F G J", "230", "50", "R", "911", "JOD", "962", null],
  KW: ["Kuwait", "C G", "240", "50", "R", "112", "KWD", "965", null],
  LB: ["Lebanon", "A B C D G", "230", "50", "R", "112 140 175", "LBP", "961", null],
  OM: ["Oman", "C G", "240", "50", "R", "9999", "OMR", "968", null],
  PS: ["Palestine", "C H", "230", "50", "R", "100 101 102", "ILS JOD", "970", null],
  QA: ["Qatar", "D G", "240", "50", "R", "999", "QAR", "974", null],
  SA: ["Saudi Arabia", "G", "230", "60", "R", "911 999 997 998", "SAR", "966", null],
  SY: ["Syria", "C E L", "220", "50", "R", null, "SYP", "963", null],
  YE: ["Yemen", "A D G", "230", "50", "R", null, "YER", "967", null],
  // ---- South Asia ---------------------------------------------------------
  AF: ["Afghanistan", "C F", "220", "50", "R", null, "AFN", "93", null],
  BD: ["Bangladesh", "A C D G K", "220", "50", "L", "999", "BDT", "880", null],
  BT: ["Bhutan", "C D G", "230", "50", "L", "113 112 110", "BTN INR", "975", null],
  IN: ["India", "C D M", "230", "50", "L", "112 100 102 101", "INR", "91", "~10% at restaurants"],
  LK: ["Sri Lanka", "D G", "230", "50", "L", "119 1990 110", "LKR", "94", null],
  MV: ["Maldives", "C D G J K L", "230", "50", "L", "119 102 118", "MVR", "960", null],
  NP: ["Nepal", "C D M", "230", "50", "L", "100 102 101", "NPR", "977", null],
  PK: ["Pakistan", "C D", "230", "50", "L", "15 1122", "PKR", "92", null],
  // ---- East Asia ----------------------------------------------------------
  CN: ["China", "A C I", "220", "50", "R", "110 120 119", "CNY", "86", NONE],
  HK: ["Hong Kong", "G", "220", "50", "L", "999", "HKD", "852", "Service charge usually added"],
  JP: ["Japan", "A B", "100", "50 60", "L", "110 119", "JPY", "81", NONE],
  KP: ["North Korea", "A C", "220", "50", "R", null, "KPW", "850", null],
  KR: ["South Korea", "C F", "220", "60", "R", "112 119", "KRW", "82", NONE],
  MN: ["Mongolia", "C E", "230", "50", "R", "102 103 101", "MNT", "976", null],
  MO: ["Macao", "D G", "220", "50", "L", "999", "MOP", "853", null],
  TW: ["Taiwan", "A B", "110", "60", "R", "110 119", "TWD", "886", NONE],
  // ---- Southeast Asia -----------------------------------------------------
  BN: ["Brunei", "G", "240", "50", "L", "993 991 995", "BND", "673", null],
  ID: ["Indonesia", "C F", "230", "50", "L", "112 110 118 113", "IDR", "62", null],
  KH: ["Cambodia", "A C G", "230", "50", "R", "117 119 118", "KHR USD", "855", null],
  LA: ["Laos", "A B C E F", "230", "50", "R", "191 195 190", "LAK", "856", null],
  MM: ["Myanmar", "C D F G", "230", "50", "R", null, "MMK", "95", null],
  MY: ["Malaysia", "G", "240", "50", "L", "999", "MYR", "60", null],
  PH: ["Philippines", "A B C", "220", "60", "R", "911", "PHP", "63", null],
  SG: ["Singapore", "G", "230", "50", "L", "999 995", "SGD", "65", "Not expected; service charge added"],
  TH: ["Thailand", "A B C O", "230", "50", "L", "191 1669 199", "THB", "66", null],
  TL: ["Timor-Leste", "C E F I", "220", "50", "L", null, "USD", "670", null],
  VN: ["Vietnam", "A C F", "220", "50", "R", "113 115 114", "VND", "84", null],
  // ---- North and Central America ------------------------------------------
  BZ: ["Belize", "A B G", "110 220", "60", "R", "911", "BZD", "501", null],
  CA: ["Canada", "A B", "120", "60", "R", "911", "CAD", "1", "15–20% at restaurants"],
  CR: ["Costa Rica", "A B", "120", "60", "R", "911", "CRC", "506", null],
  GT: ["Guatemala", "A B", "120", "60", "R", "110 128 122", "GTQ", "502", null],
  HN: ["Honduras", "A B", "120", "60", "R", "911", "HNL", "504", null],
  MX: ["Mexico", "A B", "127", "60", "R", "911", "MXN", "52", "10–15% at restaurants"],
  NI: ["Nicaragua", "A B", "120", "60", "R", "118 128 115", "NIO", "505", null],
  PA: ["Panama", "A B", "120", "60", "R", "911", "PAB USD", "507", null],
  SV: ["El Salvador", "A B", "115", "60", "R", "911", "USD", "503", null],
  US: ["United States", "A B", "120", "60", "R", "911", "USD", "1", "15–20% at restaurants"],
  PM: ["Saint Pierre and Miquelon", "C E", "230", "50", "R", "112 17 15 18", "EUR", "508", null],
  BM: ["Bermuda", "A B", "120", "60", "L", "911", "BMD", "1", null],
  // ---- Caribbean ----------------------------------------------------------
  AG: ["Antigua and Barbuda", "A B", "230", "60", "L", "911 999", "XCD", "1", null],
  AI: ["Anguilla", "A B", "110", "60", "L", "911", "XCD", "1", null],
  AW: ["Aruba", "A B F", "127", "60", "R", "911", "AWG", "297", null],
  BB: ["Barbados", "A B", "115", "50", "L", "211 511 311", "BBD", "1", null],
  BL: ["Saint Barthélemy", "C E", "230", "60", "R", "112 17 15 18", "EUR", "590", null],
  BQ: ["Caribbean Netherlands", "A C F", "127", "50", "R", "911", "USD", "599", null],
  BS: ["Bahamas", "A B", "120", "60", "L", "911 919", "BSD", "1", null],
  CU: ["Cuba", "A B C L", "110 220", "60", "R", "106 104 105", "CUP", "53", null],
  CW: ["Curaçao", "A B F", "127", "50", "R", "911", "XCG", "599", null],
  DM: ["Dominica", "D G", "230", "50", "L", "999", "XCD", "1", null],
  DO: ["Dominican Republic", "A B", "120", "60", "R", "911", "DOP", "1", null],
  GD: ["Grenada", "G", "230", "50", "L", "911", "XCD", "1", null],
  GP: ["Guadeloupe", "C D E", "230", "50", "R", "112 17 15 18", "EUR", "590", null],
  HT: ["Haiti", "A B", "110", "60", "R", "114 116 115", "HTG", "509", null],
  JM: ["Jamaica", "A B", "110", "50", "L", "119 110", "JMD", "1", null],
  KN: ["Saint Kitts and Nevis", "D G", "230", "60", "L", "911", "XCD", "1", null],
  KY: ["Cayman Islands", "A B", "120", "60", "L", "911", "KYD", "1", null],
  LC: ["Saint Lucia", "G", "240", "50", "L", "911 999", "XCD", "1", null],
  MF: ["Saint Martin", "C E", "230", "60", "R", "112 17 15 18", "EUR", "590", null],
  MQ: ["Martinique", "C D E", "230", "50", "R", "112 17 15 18", "EUR", "596", null],
  MS: ["Montserrat", "A B", "230", "60", "L", "911 999", "XCD", "1", null],
  PR: ["Puerto Rico", "A B", "120", "60", "R", "911", "USD", "1", "15–20% at restaurants"],
  SX: ["Sint Maarten", "A B C F", "110 220", "60", "R", "911", "XCG", "1", null],
  TC: ["Turks and Caicos Islands", "A B", "120", "60", "L", "911", "USD", "1", null],
  TT: ["Trinidad and Tobago", "A B", "115", "60", "L", "999 990 811", "TTD", "1", null],
  VC: ["Saint Vincent and the Grenadines", "A C E G I K", "230", "50", "L", "911 999", "XCD", "1", null],
  VG: ["British Virgin Islands", "A B", "110", "60", "L", "911 999", "USD", "1", null],
  VI: ["US Virgin Islands", "A B", "110", "60", "L", "911", "USD", "1", null],
  // ---- South America ------------------------------------------------------
  AR: ["Argentina", "C I", "220", "50", "R", "911 107 100", "ARS", "54", "~10% at restaurants"],
  BO: ["Bolivia", "A C", "230", "50", "R", "110 118 119", "BOB", "591", null],
  BR: ["Brazil", "C N", "127 220", "60", "R", "190 192 193", "BRL", "55", "10% service usually added"],
  CL: ["Chile", "C L", "220", "50", "R", "133 131 132", "CLP", "56", "10% at restaurants"],
  CO: ["Colombia", "A B", "120", "60", "R", "123", "COP", "57", null],
  EC: ["Ecuador", "A B", "120", "60", "R", "911", "USD", "593", null],
  FK: ["Falkland Islands", "G", "240", "50", "L", "999", "FKP", "500", null],
  GF: ["French Guiana", "C D E", "230", "50", "R", "112 17 15 18", "EUR", "594", null],
  GY: ["Guyana", "A B D G", "240", "60", "L", "911 913 912", "GYD", "592", null],
  PE: ["Peru", "A B C", "220", "60", "R", "105 106 116", "PEN", "51", null],
  PY: ["Paraguay", "C", "220", "50", "R", "911", "PYG", "595", null],
  SR: ["Suriname", "C F", "127", "60", "L", "115", "SRD", "597", null],
  UY: ["Uruguay", "C F I L", "230", "50", "R", "911", "UYU", "598", null],
  VE: ["Venezuela", "A B", "120", "60", "R", "911", "VES", "58", null],
  // ---- Oceania ------------------------------------------------------------
  AS: ["American Samoa", "A B F I", "120", "60", "R", "911", "USD", "1", null],
  AU: ["Australia", "I", "230", "50", "L", "000 112", "AUD", "61", NONE],
  CC: ["Cocos (Keeling) Islands", "I", "230", "50", "L", "000", "AUD", "61", null],
  CK: ["Cook Islands", "I", "240", "50", "L", null, "NZD", "682", null],
  CX: ["Christmas Island", "I", "230", "50", "L", "000", "AUD", "61", null],
  FJ: ["Fiji", "I", "240", "50", "L", "911 917", "FJD", "679", null],
  FM: ["Micronesia", "A B", "120", "60", "R", null, "USD", "691", null],
  GU: ["Guam", "A B", "110", "60", "R", "911", "USD", "1", null],
  KI: ["Kiribati", "I", "240", "50", "L", null, "AUD", "686", null],
  MH: ["Marshall Islands", "A B", "120", "60", "R", null, "USD", "692", null],
  MP: ["Northern Mariana Islands", "A B", "120", "60", "R", "911", "USD", "1", null],
  NC: ["New Caledonia", "C F", "220", "50", "R", "17 15 18", "XPF", "687", null],
  NF: ["Norfolk Island", "I", "230", "50", "L", "000", "AUD", "672", null],
  NR: ["Nauru", "I", "240", "50", "L", null, "AUD", "674", null],
  NU: ["Niue", "I", "230", "50", "L", null, "NZD", "683", null],
  NZ: ["New Zealand", "I", "230", "50", "L", "111", "NZD", "64", NONE],
  PF: ["French Polynesia", "A B E", "220", "60", "R", "17 15 18", "XPF", "689", null],
  PG: ["Papua New Guinea", "I", "240", "50", "L", null, "PGK", "675", null],
  PN: ["Pitcairn Islands", "I", "240", "50", "L", null, "NZD", "64", null],
  PW: ["Palau", "A B", "120", "60", "R", "911", "USD", "680", null],
  SB: ["Solomon Islands", "G I", "230", "50", "L", "999", "SBD", "677", null],
  TK: ["Tokelau", "I", "230", "50", "L", null, "NZD", "690", null],
  TO: ["Tonga", "I", "240", "50", "L", "911", "TOP", "676", null],
  TV: ["Tuvalu", "I", "220", "50", "L", null, "AUD", "688", null],
  UM: ["US Minor Outlying Islands", "A B", "120", "60", "R", null, "USD", "1", null],
  VU: ["Vanuatu", "C G I", "230", "50", "R", null, "VUV", "678", null],
  WF: ["Wallis and Futuna", "C E", "220", "50", "R", null, "XPF", "681", null],
  WS: ["Samoa", "I", "230", "50", "L", null, "WST", "685", null],
  // ---- North Africa -------------------------------------------------------
  DZ: ["Algeria", "C F", "230", "50", "R", "17 14", "DZD", "213", null],
  EH: ["Western Sahara", "C E", "220", "50", "R", null, "MAD", "212", null],
  LY: ["Libya", "C L", "230", "50", "R", null, "LYD", "218", null],
  MA: ["Morocco", "C E", "220", "50", "R", "19 15", "MAD", "212", null],
  SD: ["Sudan", "C D", "230", "50", "R", null, "SDG", "249", null],
  SS: ["South Sudan", "C D", "230", "50", "R", null, "SSP", "211", null],
  TN: ["Tunisia", "C E", "230", "50", "R", "197 190 198", "TND", "216", null],
  // ---- West Africa --------------------------------------------------------
  BF: ["Burkina Faso", "C E", "220", "50", "R", null, "XOF", "226", null],
  BJ: ["Benin", "C E", "220", "50", "R", null, "XOF", "229", null],
  CI: ["Côte d'Ivoire", "C E", "230", "50", "R", null, "XOF", "225", null],
  CV: ["Cabo Verde", "C F", "230", "50", "R", null, "CVE", "238", null],
  GH: ["Ghana", "D G", "230", "50", "R", "112 191 193 192", "GHS", "233", null],
  GM: ["Gambia", "G", "230", "50", "R", null, "GMD", "220", null],
  GN: ["Guinea", "C F K", "220", "50", "R", null, "GNF", "224", null],
  GW: ["Guinea-Bissau", "C", "220", "50", "R", null, "XOF", "245", null],
  LR: ["Liberia", "A B C E F", "120", "60", "R", null, "LRD USD", "231", null],
  ML: ["Mali", "C E", "220", "50", "R", null, "XOF", "223", null],
  MR: ["Mauritania", "C", "220", "50", "R", null, "MRU", "222", null],
  NE: ["Niger", "A B C D E F", "220", "50", "R", null, "XOF", "227", null],
  NG: ["Nigeria", "D G", "230", "50", "R", "112 199", "NGN", "234", null],
  SL: ["Sierra Leone", "D G", "230", "50", "R", null, "SLE", "232", null],
  SN: ["Senegal", "C D E K", "230", "50", "R", "17 15 18", "XOF", "221", null],
  TG: ["Togo", "C", "220", "50", "R", null, "XOF", "228", null],
  // ---- Central Africa -----------------------------------------------------
  AO: ["Angola", "C", "220", "50", "R", null, "AOA", "244", null],
  CD: ["DR Congo", "C D E", "220", "50", "R", null, "CDF", "243", null],
  CF: ["Central African Republic", "C E", "220", "50", "R", null, "XAF", "236", null],
  CG: ["Republic of the Congo", "C E", "230", "50", "R", null, "XAF", "242", null],
  CM: ["Cameroon", "C E", "220", "50", "R", null, "XAF", "237", null],
  GA: ["Gabon", "C", "220", "50", "R", null, "XAF", "241", null],
  GQ: ["Equatorial Guinea", "C E", "220", "50", "R", null, "XAF", "240", null],
  ST: ["São Tomé and Príncipe", "C F", "220", "50", "R", null, "STN", "239", null],
  TD: ["Chad", "C D E F", "220", "50", "R", null, "XAF", "235", null],
  // ---- East Africa --------------------------------------------------------
  BI: ["Burundi", "C E", "220", "50", "R", null, "BIF", "257", null],
  DJ: ["Djibouti", "C E", "220", "50", "R", null, "DJF", "253", null],
  ER: ["Eritrea", "C L", "230", "50", "R", null, "ERN", "291", null],
  ET: ["Ethiopia", "C E F L", "220", "50", "R", "991 907 939", "ETB", "251", null],
  KE: ["Kenya", "G", "240", "50", "L", "999 112", "KES", "254", null],
  KM: ["Comoros", "C E", "220", "50", "R", null, "KMF", "269", null],
  MG: ["Madagascar", "C D E J K", "220", "50", "R", null, "MGA", "261", null],
  MU: ["Mauritius", "C G", "230", "50", "L", "112 999 114 115", "MUR", "230", null],
  MW: ["Malawi", "G", "230", "50", "L", "997 998 999", "MWK", "265", null],
  MZ: ["Mozambique", "C F M", "220", "50", "L", "119 117 198", "MZN", "258", null],
  RE: ["Réunion", "C E", "230", "50", "R", "112 17 15 18", "EUR", "262", null],
  RW: ["Rwanda", "C J", "230", "50", "R", "112", "RWF", "250", null],
  SC: ["Seychelles", "G", "240", "50", "L", "999", "SCR", "248", null],
  SO: ["Somalia", "C", "220", "50", "R", null, "SOS", "252", null],
  TZ: ["Tanzania", "D G", "230", "50", "L", "112", "TZS", "255", null],
  UG: ["Uganda", "G", "240", "50", "L", "999 112", "UGX", "256", null],
  YT: ["Mayotte", "C E", "230", "50", "R", "112 17 15 18", "EUR", "262", null],
  ZM: ["Zambia", "C D G", "230", "50", "L", "999 991 993", "ZMW", "260", null],
  ZW: ["Zimbabwe", "D G", "220", "50", "L", "999", "ZWG USD", "263", null],
  // ---- Southern Africa ----------------------------------------------------
  BW: ["Botswana", "D G", "230", "50", "L", "999 997 998", "BWP", "267", null],
  LS: ["Lesotho", "M", "220", "50", "L", null, "LSL ZAR", "266", null],
  NA: ["Namibia", "D M", "220", "50", "L", null, "NAD ZAR", "264", null],
  SH: ["Saint Helena", "G", "240", "50", "L", null, "SHP", "290", null],
  SZ: ["Eswatini", "M", "230", "50", "L", "999", "SZL ZAR", "268", null],
  ZA: ["South Africa", "C D M N", "230", "50", "L", "10111 10177 112", "ZAR", "27", "10–15% at restaurants"],
};

const list = (s: string): string[] => s.split(" ");

function row([name, plugs, volts, hertz, drives, emergency, currencies, callingCode, tipping]: Row): CountryFacts {
  return {
    name,
    plugs: list(plugs) as PlugType[],
    volts: list(volts).map(Number),
    hertz: list(hertz).map(Number) as (50 | 60)[],
    drives: drives === "L" ? "left" : "right",
    emergency: emergency === null ? null : list(emergency),
    currencies: list(currencies),
    callingCode: `+${callingCode}`,
    tipping,
  };
}

/** Every country, keyed by ISO 3166-1 alpha-2. */
export const COUNTRIES: Readonly<Record<string, CountryFacts>> = Object.fromEntries(
  Object.entries(ROWS).map(([code, r]) => [code, row(r)]),
);

export function countryFacts(code: string): CountryFacts | undefined {
  return COUNTRIES[code.toUpperCase()];
}
