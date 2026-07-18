import type { Database } from "@/lib/supabase/database.types";

export type TerritoryMode = Database["public"]["Enums"]["territory_mode"];

// Single source of truth: continent → { ISO 3166-1 alpha-2 : English short name }.
// Territory correctness is legally load-bearing (rule 12 — out-of-scope delivery
// is infringement), so the full official set is enumerated and validated against.
// "Europe" etc. resolve to explicit codes at grant time (§9). Kosovo (XK) is
// omitted — not an official ISO 3166-1 code; add deliberately if a vendor needs it.
const CONTINENT_COUNTRIES: Record<string, Record<string, string>> = {
  Africa: {
    DZ: "Algeria", AO: "Angola", BJ: "Benin", BW: "Botswana", BF: "Burkina Faso",
    BI: "Burundi", CV: "Cabo Verde", CM: "Cameroon", CF: "Central African Republic",
    TD: "Chad", KM: "Comoros", CG: "Congo", CD: "Congo (DRC)", CI: "Côte d'Ivoire",
    DJ: "Djibouti", EG: "Egypt", GQ: "Equatorial Guinea", ER: "Eritrea", SZ: "Eswatini",
    ET: "Ethiopia", GA: "Gabon", GM: "Gambia", GH: "Ghana", GN: "Guinea",
    GW: "Guinea-Bissau", KE: "Kenya", LS: "Lesotho", LR: "Liberia", LY: "Libya",
    MG: "Madagascar", MW: "Malawi", ML: "Mali", MR: "Mauritania", MU: "Mauritius",
    YT: "Mayotte", MA: "Morocco", MZ: "Mozambique", NA: "Namibia", NE: "Niger",
    NG: "Nigeria", RE: "Réunion", RW: "Rwanda", SH: "Saint Helena",
    ST: "Sao Tome and Principe", SN: "Senegal", SC: "Seychelles", SL: "Sierra Leone",
    SO: "Somalia", ZA: "South Africa", SS: "South Sudan", SD: "Sudan", TZ: "Tanzania",
    TG: "Togo", TN: "Tunisia", UG: "Uganda", EH: "Western Sahara", ZM: "Zambia",
    ZW: "Zimbabwe",
  },
  Asia: {
    AF: "Afghanistan", AM: "Armenia", AZ: "Azerbaijan", BH: "Bahrain", BD: "Bangladesh",
    BT: "Bhutan", BN: "Brunei", KH: "Cambodia", CN: "China", CY: "Cyprus", GE: "Georgia",
    HK: "Hong Kong", IN: "India", ID: "Indonesia", IR: "Iran", IQ: "Iraq", IL: "Israel",
    JP: "Japan", JO: "Jordan", KZ: "Kazakhstan", KW: "Kuwait", KG: "Kyrgyzstan",
    LA: "Laos", LB: "Lebanon", MO: "Macao", MY: "Malaysia", MV: "Maldives",
    MN: "Mongolia", MM: "Myanmar", NP: "Nepal", KP: "North Korea", OM: "Oman",
    PK: "Pakistan", PS: "Palestine", PH: "Philippines", QA: "Qatar", SA: "Saudi Arabia",
    SG: "Singapore", KR: "South Korea", LK: "Sri Lanka", SY: "Syria", TW: "Taiwan",
    TJ: "Tajikistan", TH: "Thailand", TL: "Timor-Leste", TR: "Turkey", TM: "Turkmenistan",
    AE: "United Arab Emirates", UZ: "Uzbekistan", VN: "Vietnam", YE: "Yemen",
  },
  Europe: {
    AX: "Åland Islands", AL: "Albania", AD: "Andorra", AT: "Austria", BY: "Belarus",
    BE: "Belgium", BA: "Bosnia and Herzegovina", BG: "Bulgaria", HR: "Croatia",
    CZ: "Czechia", DK: "Denmark", EE: "Estonia", FO: "Faroe Islands", FI: "Finland",
    FR: "France", DE: "Germany", GI: "Gibraltar", GR: "Greece", GG: "Guernsey",
    HU: "Hungary", IS: "Iceland", IE: "Ireland", IM: "Isle of Man", IT: "Italy",
    JE: "Jersey", LV: "Latvia", LI: "Liechtenstein", LT: "Lithuania", LU: "Luxembourg",
    MT: "Malta", MD: "Moldova", MC: "Monaco", ME: "Montenegro", NL: "Netherlands",
    MK: "North Macedonia", NO: "Norway", PL: "Poland", PT: "Portugal", RO: "Romania",
    RU: "Russia", SM: "San Marino", RS: "Serbia", SK: "Slovakia", SI: "Slovenia",
    ES: "Spain", SJ: "Svalbard and Jan Mayen", SE: "Sweden", CH: "Switzerland",
    UA: "Ukraine", GB: "United Kingdom", VA: "Vatican City",
  },
  "North America": {
    AI: "Anguilla", AG: "Antigua and Barbuda", AW: "Aruba", BS: "Bahamas", BB: "Barbados",
    BZ: "Belize", BM: "Bermuda", BQ: "Bonaire", VG: "British Virgin Islands", CA: "Canada",
    KY: "Cayman Islands", CR: "Costa Rica", CU: "Cuba", CW: "Curaçao", DM: "Dominica",
    DO: "Dominican Republic", SV: "El Salvador", GL: "Greenland", GD: "Grenada",
    GP: "Guadeloupe", GT: "Guatemala", HT: "Haiti", HN: "Honduras", JM: "Jamaica",
    MQ: "Martinique", MX: "Mexico", MS: "Montserrat", NI: "Nicaragua", PA: "Panama",
    PR: "Puerto Rico", BL: "Saint Barthélemy", KN: "Saint Kitts and Nevis",
    LC: "Saint Lucia", MF: "Saint Martin", PM: "Saint Pierre and Miquelon",
    VC: "Saint Vincent and the Grenadines", SX: "Sint Maarten", TT: "Trinidad and Tobago",
    TC: "Turks and Caicos Islands", US: "United States", VI: "U.S. Virgin Islands",
  },
  "South America": {
    AR: "Argentina", BO: "Bolivia", BR: "Brazil", CL: "Chile", CO: "Colombia",
    EC: "Ecuador", FK: "Falkland Islands", GF: "French Guiana", GY: "Guyana",
    PY: "Paraguay", PE: "Peru", SR: "Suriname", UY: "Uruguay", VE: "Venezuela",
  },
  Oceania: {
    AS: "American Samoa", AU: "Australia", CX: "Christmas Island", CC: "Cocos Islands",
    CK: "Cook Islands", FJ: "Fiji", PF: "French Polynesia", GU: "Guam", KI: "Kiribati",
    MH: "Marshall Islands", FM: "Micronesia", NR: "Nauru", NC: "New Caledonia",
    NZ: "New Zealand", NU: "Niue", NF: "Norfolk Island", MP: "Northern Mariana Islands",
    PW: "Palau", PG: "Papua New Guinea", PN: "Pitcairn", WS: "Samoa",
    SB: "Solomon Islands", TK: "Tokelau", TO: "Tonga", TV: "Tuvalu", VU: "Vanuatu",
    WF: "Wallis and Futuna",
  },
  Antarctica: {
    AQ: "Antarctica", BV: "Bouvet Island", IO: "British Indian Ocean Territory",
    TF: "French Southern Territories", HM: "Heard Island and McDonald Islands",
    GS: "South Georgia and the South Sandwich Islands",
    UM: "United States Minor Outlying Islands",
  },
};

// alpha-2 → English short name (flattened).
export const ISO_COUNTRIES: Record<string, string> = Object.assign(
  {},
  ...Object.values(CONTINENT_COUNTRIES),
);

// Continent → member alpha-2 codes (a UI convenience that still resolves to
// explicit codes at grant time — §9 "Europe shifts").
export const CONTINENTS: Record<string, string[]> = Object.fromEntries(
  Object.entries(CONTINENT_COUNTRIES).map(([k, v]) => [k, Object.keys(v)]),
);

const isAlpha2 = (c: string) => /^[A-Z]{2}$/.test(c) && c in ISO_COUNTRIES;

// Resolve a UI selection (already expanded to country codes) to a deduped,
// validated, sorted alpha-2 list. Throws on an unknown/invalid code.
export function resolveTerritories(mode: TerritoryMode, countryCodes: string[]): string[] {
  if (mode === "world") return [];
  const set = new Set<string>();
  for (const raw of countryCodes) {
    const code = raw.trim().toUpperCase();
    if (!isAlpha2(code)) throw new Error(`Unknown territory code: ${raw}`);
    set.add(code);
  }
  if (set.size === 0) throw new Error("Include/exclude requires at least one country");
  return [...set].sort();
}

// Human summary for a grant's territory scope.
export function describeTerritory(mode: TerritoryMode, codes: string[]): string {
  if (mode === "world") return "Worldwide";
  const names = codes.map((c) => ISO_COUNTRIES[c] ?? c);
  const shown = names.slice(0, 4).join(", ") + (names.length > 4 ? ` +${names.length - 4}` : "");
  return mode === "exclude" ? `Worldwide except ${shown}` : shown;
}
