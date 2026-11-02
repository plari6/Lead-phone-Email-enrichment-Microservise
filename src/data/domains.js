// Small built-in lists used by the free local pre-check.
// Paid providers catch far more; these just stop obvious junk before it costs a credit.

export const DISPOSABLE_DOMAINS = new Set([
  '10minutemail.com', '10minutemail.net', '20minutemail.com', 'anonbox.net', 'burnermail.io',
  'discard.email', 'dispostable.com', 'dropmail.me', 'emailondeck.com', 'fakeinbox.com',
  'fakemail.net', 'getairmail.com', 'getnada.com', 'guerrillamail.biz', 'guerrillamail.com',
  'guerrillamail.de', 'guerrillamail.net', 'guerrillamail.org', 'guerrillamailblock.com',
  'harakirimail.com', 'inboxbear.com', 'incognitomail.org', 'jetable.org', 'mail-temp.com',
  'mailcatch.com', 'maildrop.cc', 'mailinator.com', 'mailinator.net', 'mailnesia.com',
  'mailpoof.com', 'mintemail.com', 'moakt.com', 'mohmal.com', 'mytemp.email', 'nada.email',
  'sharklasers.com', 'spam4.me', 'spambox.us', 'spamgourmet.com', 'temp-mail.io', 'temp-mail.org',
  'tempail.com', 'tempinbox.com', 'tempmail.com', 'tempmail.net', 'tempmailo.com', 'tempr.email',
  'throwawaymail.com', 'trashmail.com', 'trashmail.de', 'trashmail.net', 'wegwerfmail.de',
  'yopmail.com', 'yopmail.fr', 'yopmail.net', 'emailfake.com', 'mailtemp.net', 'tmail.ws',
]);

export const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'yahoo.fr', 'ymail.com',
  'hotmail.com', 'hotmail.co.uk', 'hotmail.fr', 'outlook.com', 'live.com', 'msn.com',
  'aol.com', 'icloud.com', 'me.com', 'mac.com', 'proton.me', 'protonmail.com', 'pm.me',
  'gmx.com', 'gmx.de', 'gmx.net', 'web.de', 'mail.com', 'zoho.com', 'yandex.com', 'yandex.ru',
  'mail.ru', 'qq.com', '163.com', '126.com', 'tutanota.com', 'fastmail.com', 'hey.com',
]);

// Shared inboxes. Fine for some campaigns, but replies are less personal and they often bounce.
export const ROLE_PREFIXES = new Set([
  'admin', 'administrator', 'billing', 'careers', 'contact', 'help', 'hello', 'hr', 'info',
  'jobs', 'legal', 'mail', 'marketing', 'media', 'noreply', 'no-reply', 'office', 'postmaster',
  'press', 'privacy', 'sales', 'security', 'service', 'support', 'team', 'webmaster', 'abuse',
  'accounts', 'enquiries', 'inquiries', 'feedback', 'donotreply', 'do-not-reply',
]);

// Common typos, so we can suggest the right address.
export const DOMAIN_TYPOS = {
  'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gamil.com': 'gmail.com',
  'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'gnail.com': 'gmail.com',
  'hotmial.com': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'hotmail.con': 'hotmail.com',
  'outlok.com': 'outlook.com', 'outlook.con': 'outlook.com',
  'yahooo.com': 'yahoo.com', 'yaho.com': 'yahoo.com', 'yahoo.con': 'yahoo.com',
  'iclod.com': 'icloud.com', 'icloud.con': 'icloud.com',
};
