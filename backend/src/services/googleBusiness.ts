// GOOGLE BUSINESS PROFILE (ultima bifă din „toate aplicațiile", 14 aug).
// Ce face v1: VEDE contul și locațiile firmei omului — dovada că legătura
// trăiește. Particularitatea CINSTITĂ a acestui API: spre deosebire de restul
// (Gmail, Drive, YouTube…), Google ține cota lui la ZERO până când aprobă
// proiectul printr-un formular oficial de acces — deci până la aprobarea
// ownerului, orice apel corect se întoarce cu 403/429. Unealta spune EXACT
// asta, cu pașii, în loc să mintă cu „nu merge".
const CONT_URL = 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts'
const LOCATII_URL = (cont: string): string =>
  `https://mybusinessbusinessinformation.googleapis.com/v1/${cont}/locations?readMask=title,storefrontAddress,phoneNumbers,websiteUri&pageSize=10`

const PASII_APROBARII =
  'API-ul Business Profile are cota 0 până aprobă Google proiectul: (1) în Cloud Console, pe proiectul aplicației, pornește „My Business Account Management API" și „My Business Business Information API"; (2) completează formularul oficial „Business Profile APIs access request" cu numărul proiectului; (3) după emailul de aprobare, încearcă din nou — fără alt cod.'

interface RaspunsCont {
  accounts?: { name?: string; accountName?: string; type?: string }[]
}
interface RaspunsLocatii {
  locations?: {
    title?: string
    storefrontAddress?: { addressLines?: string[]; locality?: string }
    phoneNumbers?: { primaryPhone?: string }
    websiteUri?: string
  }[]
}

/** Contul + locațiile Business Profile ale omului — sau motivul cinstit. */
export async function businessVezi(
  token: string,
  baseUrl: string,
): Promise<Record<string, unknown>> {
  const rc = await fetch(CONT_URL, { headers: { authorization: `Bearer ${token}` } })
  if (rc.status === 401)
    return {
      error: 'consimtamant_lipsa',
      motiv: `Business Profile cere o încuviințare separată (scope sensibil): deschide ${baseUrl}/auth/google/connect-business și aprobă.`,
    }
  if (rc.status === 403 || rc.status === 429)
    return { error: 'cota_neaprobata', motiv: PASII_APROBARII }
  if (!rc.ok) return { error: 'business_indisponibil', motiv: `Google a răspuns ${rc.status} la citirea contului.` }

  const cj = (await rc.json().catch(() => ({}))) as RaspunsCont
  const cont = cj.accounts?.[0]
  if (!cont?.name)
    return {
      error: 'fara_cont',
      motiv:
        'Contul Google conectat nu administrează niciun profil de firmă (business.google.com arată dacă ai unul sau îl poți crea).',
    }

  const rl = await fetch(LOCATII_URL(cont.name), { headers: { authorization: `Bearer ${token}` } })
  if (rl.status === 403 || rl.status === 429)
    return { cont: cont.accountName ?? cont.name, error: 'cota_neaprobata', motiv: PASII_APROBARII }
  const lj = rl.ok ? ((await rl.json().catch(() => ({}))) as RaspunsLocatii) : {}
  const locatii = (lj.locations ?? []).map((l) => ({
    nume: l.title ?? '—',
    adresa: [...(l.storefrontAddress?.addressLines ?? []), l.storefrontAddress?.locality]
      .filter(Boolean)
      .join(', '),
    telefon: l.phoneNumbers?.primaryPhone ?? null,
    site: l.websiteUri ?? null,
  }))
  return {
    ok: true,
    cont: cont.accountName ?? cont.name,
    tip: cont.type ?? null,
    locatii,
    indicatie: locatii.length
      ? 'Profilul firmei e legat — pot citi datele locațiilor la cerere.'
      : 'Contul există dar nu are locații încă (se adaugă din business.google.com).',
  }
}
