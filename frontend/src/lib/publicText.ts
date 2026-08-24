// ── PUBLIC SURFACE TEXT — ENGLISH BY DESIGN ───────────────────────────────
//
// Adrian's rule (Jul 30): "on logout it shows ENGLISH; on re-login it
// returns to the user's detected language". So everything a LOGGED-OUT person
// sees — the start page, sign-in, prices — is in English, always. The
// personal language applies only after we know who they are.
//
// Why a separate file and not the i18n.ts dictionary: there every key
// cere toate cele 7 limbi. Aici traducerile ar fi cod mort — textele astea NU se
// never renders in another language. One single source, English, with no
// phantom translations to maintain.
//
// What it was before: the login and credits pages were written DIRECTLY in
// Romanian, even though the start page is in English. A visitor from any
// country read "Your brilliant assistant", clicked "Sign in with email" and
// landed on a Romanian page. 29 texts, none ever passed through i18n.
export const PUBLIC_TEXT = {
  // The start page — the links under the Google button
  emailSignIn: 'Sign in with email',
  creditsPricing: 'Credits & pricing',
  userManual: 'User manual',

  // Signing in
  loginTitle: 'Sign in',
  magicTitle: 'Sign in with an email link',
  resetTitle: 'New password',
  continueGoogle: 'Continue with Google',
  orEmail: 'or with your email',
  password: 'Password',
  newPassword: 'New password (at least 8 characters)',
  signIn: 'Sign in',
  sendLink: 'Send me the link',
  savePassword: 'Save password',
  passwordless: 'Sign in without a password (email link)',
  forgotPassword: 'I forgot my password',
  backToSignIn: 'Back to sign in',

  // Server messages, in human terms
  errEmailInvalid: "That email doesn't look valid.",
  errPasswordShort: 'The password must be at least 8 characters.',
  errWrongCredentials: 'Wrong email or password.',
  errLinkExpired: 'That link has expired — ask for a new one.',
  errGeneric: "That didn't work — please try again.",
  errResetGeneric: "That didn't work — ask for another reset link.",
  magicSent: 'If the email is valid, your sign-in link is on its way — check your inbox (and spam).',
  resetSent: 'If an account exists for this email, the reset link is on its way.',
  typeEmailFirst: 'Enter your email first, then press "I forgot my password".',

  // Credite
  creditsTitle: 'Kelionai credits',
  creditsBlurb: 'Credits cover everything Kelion does: conversation, voice, vision, searches.',
  creditsUnit: (n: number): string => `${n} credits`,
  creditsSignInFirst: 'Sign in to view your balance, payment history and checkout options.',
  checkoutTitle: 'Secure Revolut checkout',
  checkoutHint: 'The amount and your account are already linked. Confirm the payment on Revolut; no reference code is needed.',
  checkoutOpen: 'Continue securely to Revolut ↗',
  checkoutWaiting: 'Credit is added only after Revolut confirms the completed payment.',
  lowCreditReminderLabel: 'Low-credit reminder (payment always requires my confirmation)',
  lowCreditReminderAmount: 'Suggested payment',
  lowCreditReminderSaved: 'Reminder saved ✓',
  errPaymentStart: "The payment didn't start — please try again.",
  accountLink: 'Sign in',
  privacyLink: 'Privacy',
  termsLink: 'Terms',

  // The email field placeholder (Login) — it was 'email@exemplu.com', Romanian
  // on the English-by-design public surface (audit Aug 2).
  emailPlaceholder: 'email@example.com',

  // The visitor live-chat widget (landing page, logged-out surface). Audit
  // Aug 2: every one of its texts was hardcoded in the component, and a failed
  // poll/send showed NOTHING — the empty-state hint read as "no replies yet"
  // while the owner's replies existed, and a failed send looked like success.
  vchatHead: 'Message us — we reply live',
  vchatClose: 'Close',
  vchatHint: "Hi! Leave us a message and we'll reply as soon as we can.",
  vchatPlaceholder: 'Your message…',
  vchatToggle: 'Chat',
  vchatSendFailed: "Your message didn't go through — please try again.",
  vchatOffline: "We can't reach the server right now — replies may be delayed.",

  // Landing page: lead form and contact.
  leadThanks: "Thanks — we'll get back to you soon.",
  leadTitle: "Leave your email and we'll reach out",
  leadSending: 'Sending…',
  leadSend: 'Send',
  leadNotePlaceholder: 'Short message (optional)',
  contactLink: 'Contact',
} as const
