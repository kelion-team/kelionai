import { useEffect, useState } from 'react'
import BackLink from './BackLink'
import { adminStrings } from '../lib/adminText'
import { starePush, activeazaPush, dezactiveazaPush, type StarePush } from '../lib/pushTelefon'
import { ADMIN_TABS, type AdminTab } from '../lib/admin'
import type { BrainCredit } from '../pages/Stage'
import { CreditAICard } from './admin/shared'
import { AdminFinance, AdminStores } from './admin/AdminBani'
import { AdminInbox, AdminNotificari, AdminShare } from './admin/AdminComunicare'
import { AdminUsers, AdminTokenuri, AdminGesturi } from './admin/AdminUtilizatori'
import { AdminConstructor, AdminCreier } from './admin/AdminProductie'
import { AdminSistem, AdminErori, AdminRecuperare } from './admin/AdminOperatii'

// ── Tab grouping (logical, for future sidebar) ─────────────────────────────
// interface TabGroup { label: string; tabs: AdminTab[] }
// const TAB_GROUPS: TabGroup[] = [
//   { label: 'Bani', tabs: ['finance', 'stores'] },
//   { label: 'Producție', tabs: ['constructor', 'creier'] },
//   { label: 'Operațiuni', tabs: ['sistem', 'erori', 'recuperare'] },
//   { label: 'Comunicare', tabs: ['inbox', 'notificari', 'share'] },
//   { label: 'Utilizatori', tabs: ['users', 'tokenuri', 'gesturi'] },
// ]

export default function AdminPanel({
  onClose,
  initialTab,
  brainCredit,
}: {
  readonly onClose: () => void
  readonly initialTab?: AdminTab
  readonly brainCredit?: BrainCredit | null
}) {
  const A = adminStrings()
  const [tab, setTab] = useState<AdminTab>(initialTab ?? 'finance')
  const [push, setPush] = useState<StarePush>('inactiv')
  const [pushBusy, setPushBusy] = useState(false)
  const [peek, setPeek] = useState(false)

  useEffect(() => { void starePush().then(setPush) }, [])
  useEffect(() => { if (initialTab) setTab(initialTab) }, [initialTab])

  const comutaPush = async (): Promise<void> => {
    setPushBusy(true)
    try { setPush(push === 'activ' ? await dezactiveazaPush() : await activeazaPush()) }
    finally { setPushBusy(false) }
  }

  const previewAndPeek = (_clip: string): void => {
    setPeek(true)
    window.setTimeout(() => setPeek(false), 3500)
  }

  const tabLabels: Record<AdminTab, string> = {
    finance: A.tabMoney,
    users: A.tabUsers,
    share: A.tabShare,
    stores: A.tabStores,
    inbox: A.tabInbox,
    gesturi: A.tabGestures,
    tokenuri: A.tabTokens,
    constructor: A.tabBuilder,
    recuperare: A.tabRecovery,
    sistem: A.tabSystem,
    erori: A.tabErrors,
    notificari: A.tabNotifications,
    creier: A.tabBrain,
  }

  return (
    <div className={`admin-overlay ${peek ? 'peek' : ''}`}>
      <div className="admin-panel admin-panel-v2">
        <header className="admin-head">
          <div className="admin-tabs">
            {ADMIN_TABS.map((tabId) => (
              <button
                key={tabId}
                type="button"
                className={`admin-tab ${tab === tabId ? 'sel' : ''}`}
                onClick={() => setTab(tabId)}
              >
                {tabLabels[tabId]}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="ghost"
            disabled={pushBusy || push === 'nesuportat' || push === 'refuzat'}
            title={
              push === 'refuzat' ? 'Notificările sunt blocate din setările browserului — deblochează-le acolo întâi.'
              : push === 'nesuportat' ? 'Browserul ăsta nu știe Web Push.'
              : 'Anunțurile de panou (PR gata, alarme) vin și pe telefonul ăsta.'
            }
            onClick={() => void comutaPush()}
          >
            {pushBusy ? '🔔 …'
              : push === 'activ' ? '🔔 Pe telefon: pornit'
              : push === 'refuzat' ? '🔕 blocat din browser'
              : push === 'nesuportat' ? '🔕 indisponibil aici'
              : '🔔 Pornește pe telefon'}
          </button>
          <BackLink onBack={onClose} />
        </header>

        <CreditAICard brainCredit={brainCredit} />

        <section className="admin-content">
          {tab === 'finance' && <AdminFinance brainCredit={brainCredit} />}
          {tab === 'stores' && <AdminStores />}
          {tab === 'constructor' && <AdminConstructor />}
          {tab === 'creier' && <AdminCreier />}
          {tab === 'sistem' && <AdminSistem brainCredit={brainCredit} />}
          {tab === 'erori' && <AdminErori />}
          {tab === 'recuperare' && <AdminRecuperare />}
          {tab === 'inbox' && <AdminInbox />}
          {tab === 'notificari' && <AdminNotificari />}
          {tab === 'share' && <AdminShare />}
          {tab === 'users' && <AdminUsers />}
          {tab === 'tokenuri' && <AdminTokenuri />}
          {tab === 'gesturi' && <AdminGesturi onPeek={previewAndPeek} />}
        </section>
      </div>
    </div>
  )
}
