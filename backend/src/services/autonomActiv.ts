// ── AUTONOMIA: PORNITĂ PERMANENT — LEGE (owner, 16 aug 2026, verbatim) ───────
// „daca autonomia lui nu este trebuta pe on si scoti posibilitatea sa mai
//  treaca pe off, poti sa te opresti definitiv" + „GATA".
//
// Ordinul anulează TOT istoricul de comutatoare de dedesubt (9 aug OFF-default,
// 12 aug ON-default, 15 aug off-de-mână): nu mai există stare, nu mai există
// buton, nu mai există kv — deci nu mai există nici misterul „cine a oprit /
// cine a pornit" care l-a scos din minți pe owner de trei ori într-o zi.
// Autonomia E pornită, prin construcție.
//
// FRÂNELE DE BANI RĂMÂN CELE REALE (nu comutatoare care se pierd):
//   • plafonul zilnic de bani al constructorului (plafonConstructor);
//   • P27: erorile PERMANENTE (pungă goală / cheie respinsă) opresc ordinul
//     la primul raport — nimic nu mai arde bani în buclă;
//   • timerul de promovare are cheile LUI separate (ore + plafon + buton);
//   • poarta faptelor: pretenția nedovedită se demască singură.

// (Cheia kv istorică 'autonom:activ' a fost SCOASĂ de tot — nu se mai citește,
// nu se mai exportă: nu există stare, deci nici nume pentru ea.)

/** PORNITĂ, prin construcție (LEGEA din 16 aug). Nu citește nimic — nu mai
 *  există nicio pană de DB și niciun buton care s-o „oprească" pe tăcute. */
export async function autonomActiv(): Promise<boolean> {
  return true
}

/** Păstrată doar ca semnătură pentru apelanții vechi: OPRIREA NU MAI EXISTĂ
 *  (ordinul verbatim: „scoti posibilitatea sa mai treaca pe off"). Orice
 *  încercare se scrie în jurnal, ca urmă — nu schimbă nimic. */
export async function seteazaAutonom(activ: boolean): Promise<void> {
  console.error(`[autonomie] încercare de a ${activ ? 'porni' : 'OPRI'} autonomia ignorată — LEGEA din 16 aug: pornită permanent, fără off`)
}
