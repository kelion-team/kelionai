// ── TEXTUL SUPRAFEȚEI PUBLICE — ENGLEZĂ PRIN DESIGN ─────────────────────────
//
// Regula lui Adrian (30 iul): „la delogare se afișează ENGLEZĂ; la relogare se
// revine la limba detectată a userului". Deci tot ce vede un om NELOGAT — pagina
// de start, intrarea în cont, prețurile — e în engleză, întotdeauna. Limba
// personală se aplică abia după ce știm cine e.
//
// De ce un fișier separat și nu dicționarul din i18n.ts: acolo fiecare cheie
// cere toate cele 7 limbi. Aici traducerile ar fi cod mort — textele astea NU se
// randează niciodată în altă limbă. O singură sursă, engleză, fără traduceri
// fantomă de întreținut.
//
// Ce a fost înainte: paginile de login și de credite erau scrise DIRECT în
// română, deși pagina de start e în engleză. Un vizitator din orice țară citea
// „Your brilliant assistant", dădea click pe „Intră cu email" și ateriza pe o
// pagină românească. 29 de texte, niciunul trecut vreodată prin i18n.
export const PUBLIC_TEXT = {
  // Pagina de start — linkurile de sub butonul Google
  emailSignIn: 'Sign in with email',
  creditsPricing: 'Credits & pricing',
  zoomQr: 'Enlarge the code to scan it',

  // Intrarea în cont
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

  // Mesaje de la server, pe înțelesul omului
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
  creditsRate: (perPound: number): string => `£1 = ${perPound} credits. Payment is secured by Stripe.`,
  creditsUnit: (n: number): string => `${n} credits`,
  creditsSignInFirst: 'You need to be signed in to buy — the buttons take you to sign-in.',
  errPaymentStart: "The payment didn't start — please try again.",
  accountLink: 'Sign in',
  privacyLink: 'Privacy',
  termsLink: 'Terms',

  // Bara de versiune nouă (apare pe orice shell, inclusiv nelogat)
  updateAvailable: 'A new version is available',
  updateNow: 'Update now',
} as const
