// Einmaliger Check-Lauf (lokal / manuell). Für den Dauerbetrieb ruft ein
// Scheduler GET /api/run-checks auf.
import { runChecks } from "../src/lib/check";

runChecks(true)
  .then((s) => {
    console.log(`Checked ${s.checked} @ ${s.at}`);
    for (const r of s.results) {
      console.log(`  ${r.status.padEnd(9)} ${r.responseMs ?? "--"}ms  ${r.name}`);
    }
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
