/** Input is ALREADY filtered by the authenticated route. Authorization,
 * private roster access and agent execution stay outside this pure formatter. */
export function publicAgentRoster(agents: readonly { id: string; nume: string; rol: string }[]): {
  count: number; agents: { id: string; nume: string; rol: string; url: string }[]
} {
  return { count:agents.length,agents:agents.map((a) => ({ id:a.id,nume:a.nume,rol:a.rol,url:`/api/a2a/${a.id}` })) }
}
