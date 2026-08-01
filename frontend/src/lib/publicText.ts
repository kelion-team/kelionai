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
  zoomQr: 'Enlarge the code to scan it',

  // Signing in
  loginTitle: 'Sign in',
  registerTitle: 'Create your account',
  magicTitle: 'Sign in with an email link',
  resetTitle: 'New password',
  continueGoogle: 'Continue with Google',
  orEmail: 'or with your email',
  yourName: 'Your name',
  password: 'Password',
  newPassword: 'New password (at least 8 characters)',
  signIn: 'Sign in',
  createAccount: 'Create account',
  sendLink: 'Send me the link',
  savePassword: 'Save password',
  noAccount: 'No account? Create one',
  passwordless: 'Sign in without a password (email link)',
  forgotPassword: 'I forgot my password',
  backToSignIn: 'Back to sign in',

  // Server messages, in human terms
  errEmailInvalid: "That email doesn't look valid.",
  errPasswordShort: 'The password must be at least 8 characters.',
  errAccountExists: 'An account already exists for this email — sign in with your password, or ask for a link.',
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
  creditsRate: (perPound: number): string => `£1 = ${perPound} credits. Secure payment via Revolut.`,
  creditsUnit: (n: number): string => `${n} credits`,
  creditsSignInFirst: 'You need to be signed in to buy — the buttons take you to sign-in.',
  // The auto top-up checkbox, shown at payment time (Adrian, Aug 1: "auto-pay
  // selectable with a checkbox when the user pays"). Honest wording: we
  // PREPARE the payment, the user always confirms the money move.
  autoTopUpLabel: 'Auto top-up: when my credit runs low, prepare my refill automatically (I confirm with one tap)',
  autoTopUpAmount: 'Refill amount',
  autoTopUpSaved: 'Saved ✓',
  errPaymentStart: "The payment didn't start — please try again.",
  accountLink: 'Sign in',
  privacyLink: 'Privacy',
  termsLink: 'Terms',

  // The new-version bar (appears on any shell, including logged-out)
  updateAvailable: 'A new version is available',
  updateNow: 'Update now',
} as const
