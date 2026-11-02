/**
 * Turns verification results into a campaign decision:
 * which channels (email / sms / call) a lead can go into, and an overall status.
 *   ready    = at least one channel is safe to use
 *   review   = nothing safe yet, but something is worth a human look (risky / unknown)
 *   rejected = no usable contact data
 */
export const DEFAULT_POLICY = {
  allowRiskyEmail: false,
  allowFreeEmail: true,
  allowRoleEmail: true,
  smsLineTypes: ['mobile'],
  callLineTypes: ['mobile', 'landline', 'landline_or_mobile', 'voip'],
};

export function decide(email, phone, policy = DEFAULT_POLICY) {
  const p = { ...DEFAULT_POLICY, ...policy };
  const notes = [];

  let emailAction = 'none';
  switch (email?.status) {
    case 'deliverable':
      emailAction = 'add';
      break;
    case 'risky':
      emailAction = p.allowRiskyEmail ? 'add' : 'review';
      break;
    case 'unknown':
      emailAction = 'review';
      break;
    case 'undeliverable':
      emailAction = 'suppress';
      break;
    default:
      emailAction = 'none';
  }
  if (emailAction === 'add' && email.flags?.role && !p.allowRoleEmail) {
    emailAction = 'review';
    notes.push('role account blocked by policy');
  }
  if (emailAction === 'add' && email.suggestion) {
    // "gmial.com" may accept mail, but it won't reach the person.
    emailAction = 'review';
  }
  if (emailAction === 'add' && email.flags?.free && !p.allowFreeEmail) {
    emailAction = 'review';
    notes.push('free email blocked by policy');
  }

  const phoneValid = phone?.status === 'valid';
  const canSms = phoneValid && p.smsLineTypes.includes(phone.lineType);
  const canCall = phoneValid && p.callLineTypes.includes(phone.lineType);
  const phoneNeedsReview = phoneValid && !canCall && !canSms;

  const channels = [];
  if (emailAction === 'add') channels.push('email');
  if (canSms) channels.push('sms');
  if (canCall) channels.push('call');

  let status;
  if (channels.length) status = 'ready';
  else if (emailAction === 'review' || phoneNeedsReview) status = 'review';
  else status = 'rejected';

  if (emailAction === 'suppress') notes.push('email will bounce: keep it out of sequences');
  if (phone?.status === 'invalid') notes.push('phone number is invalid');
  if (phoneValid && phone.lineType === 'landline_or_mobile') notes.push('line type unconfirmed: SMS disabled until a carrier lookup confirms mobile');
  if (phoneValid && !canSms && phone.lineType === 'landline') notes.push('landline: call only, no SMS');
  if (email?.suggestion) notes.push(`did you mean ${email.suggestion}?`);

  return {
    status,
    channels,
    canEmail: emailAction === 'add',
    canSms,
    canCall,
    emailAction,
    score: leadScore(email, phone),
    notes,
  };
}

/** 0-100 contactability score: email is worth up to 60, phone up to 40. */
export function leadScore(email, phone) {
  const emailPts = { deliverable: 60, risky: 30, unknown: 15 }[email?.status] ?? 0;
  let phonePts = 0;
  if (phone?.status === 'valid') {
    if (phone.lineType === 'mobile') phonePts = 40;
    else if (['landline', 'voip', 'landline_or_mobile'].includes(phone.lineType)) phonePts = 25;
    else phonePts = 10;
  }
  return emailPts + phonePts;
}
