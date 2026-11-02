// Fake providers with predictable answers, for demos and tests (no network, no credits).
// Email rules (by the part before @): contains "bounce"/"invalid" -> undeliverable,
// "catchall"/"risky" -> risky, "unknown" -> unknown, otherwise deliverable.
// Phone rules: real numbering-plan data, and for US-style "landline_or_mobile" numbers
// an even last digit is mobile and an odd one is landline.
import { inspectPhone } from './local.js';

export function createMockEmailVerifier(name = 'mock') {
  const verifier = {
    name,
    calls: 0,
    async verify(email) {
      verifier.calls++;
      const local = email.split('@')[0];
      let status = 'deliverable';
      if (/bounce|invalid/.test(local)) status = 'undeliverable';
      else if (/catchall|risky/.test(local)) status = 'risky';
      else if (/unknown/.test(local)) status = 'unknown';
      const score = { deliverable: 92, risky: 55, unknown: null, undeliverable: 3 }[status];
      return {
        provider: name,
        status,
        score,
        flags: { smtp: status === 'deliverable', catchAll: status === 'risky', mx: true },
        rawStatus: status,
        suggestion: null,
      };
    },
  };
  return verifier;
}

const CARRIERS = ['Verizon Wireless', 'T-Mobile USA', 'AT&T Mobility', 'Lumen', 'Twilio (VoIP)'];

export function createMockPhoneVerifier() {
  const verifier = {
    name: 'mock',
    calls: 0,
    async lookup(e164) {
      verifier.calls++;
      const info = inspectPhone(e164);
      let lineType = info.lineType;
      if (lineType === 'landline_or_mobile') lineType = Number(e164.at(-1)) % 2 === 0 ? 'mobile' : 'landline';
      const last = Number(e164.at(-1));
      return {
        provider: 'mock',
        valid: Boolean(info.valid),
        e164: info.e164 || e164,
        international: info.international || null,
        national: info.national || null,
        country: info.country || null,
        countryName: null,
        location: null,
        carrier: lineType === 'voip' ? CARRIERS[4] : CARRIERS[last % 4],
        lineType,
      };
    },
  };
  return verifier;
}

/** DNS stand-in: any domain containing "nomx" has no mail servers. */
export async function mockResolveMx(domain) {
  if (domain.includes('nomx')) throw Object.assign(new Error('no mx'), { code: 'ENODATA' });
  return [{ exchange: `mx.${domain}`, priority: 10 }];
}
