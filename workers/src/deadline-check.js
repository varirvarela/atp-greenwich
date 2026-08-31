// Deadline penalty check — run via config/deadlineCheckRequest flag
// Lifts penalties from matches whose deadline was extended,
// applies penalties to matches whose deadline has passed.

export async function runDeadlineCheck(db) {
  const now     = Date.now();
  const seasons = await db.get('seasons').then(v => v || {});

  let penalised = 0;
  let lifted    = 0;

  for (const [sid, season] of Object.entries(seasons)) {
    const leagues = season.leagues || {};
    for (const [lid, league] of Object.entries(leagues)) {
      const gs = league.groupStageConfig || {};
      if (gs.status !== 'active') continue;

      const matches = league.matches || {};
      const updates = {};

      for (const [mid, match] of Object.entries(matches)) {
        if (!match.groupMatch) continue;
        if (match.status === 'confirmed') continue;
        if (match.forfeited) continue;

        const deadlinePassed = match.deadline && match.deadline <= now;

        if (match.deadlinePenaltyApplied && !deadlinePassed) {
          updates[`seasons/${sid}/leagues/${lid}/matches/${mid}/deadlinePenaltyApplied`] = null;
          lifted++;
        } else if (!match.deadlinePenaltyApplied && deadlinePassed) {
          updates[`seasons/${sid}/leagues/${lid}/matches/${mid}/deadlinePenaltyApplied`] = true;
          penalised++;
        }
      }

      if (Object.keys(updates).length > 0) {
        await Promise.all(Object.entries(updates).map(([path, val]) => db.set(path, val)));
        const l = Object.values(updates).filter(v => v === null).length;
        const p = Object.values(updates).filter(v => v === true).length;
        if (l) console.log(`[${sid}/${lid}] Lifted ${l} premature penalty/penalties.`);
        if (p) console.log(`[${sid}/${lid}] Applied ${p} new penalty/penalties.`);
      }
    }
  }

  console.log(`Deadline check done. Lifted: ${lifted}  Penalised: ${penalised}`);
  return { lifted, penalised };
}
