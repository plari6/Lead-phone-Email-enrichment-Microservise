// Finds the email / phone / country columns in whatever headers a CRM export uses.
const CANDIDATES = {
  email: ['email', 'emailaddress', 'workemail', 'businessemail', 'email1', 'primaryemail', 'mail', 'e-mail', 'contactemail'],
  phone: ['phone', 'phonenumber', 'mobile', 'mobilephone', 'mobilenumber', 'cell', 'cellphone', 'telephone', 'tel', 'directphone', 'workphone', 'contactnumber', 'whatsapp', 'phone1', 'primaryphone'],
  country: ['country', 'countrycode', 'countryiso', 'iso2'],
};

const norm = (h) => String(h).toLowerCase().replace(/[^a-z0-9]/g, '');

export function detectColumns(headers = [], overrides = {}) {
  const out = {};
  for (const [field, candidates] of Object.entries(CANDIDATES)) {
    if (overrides[field]) {
      out[field] = overrides[field];
      continue;
    }
    const normalized = headers.map((h) => [h, norm(h)]);
    // Exact match first, then "contains" (e.g. "Work Email (primary)").
    const exact = normalized.find(([, n]) => candidates.map(norm).includes(n));
    const partial = normalized.find(([, n]) => n.includes(field === 'country' ? 'country' : field));
    out[field] = (exact || partial)?.[0] ?? null;
  }
  return out;
}
