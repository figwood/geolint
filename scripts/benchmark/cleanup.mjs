// Playwright browsers use a separate process group from their Node controller.
export function killProcessGroups(pids) {
  for (const pid of new Set(pids)) {
    if (!Number.isSafeInteger(pid) || pid <= 1) continue;
    try { process.kill(-pid, 'SIGKILL'); }
    catch { try { process.kill(pid, 'SIGKILL'); } catch {} }
  }
}
