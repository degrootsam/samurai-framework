// Preloaded into the test runner and into every test file (`tsx --import ./scripts/test-tmp.mjs --test ...`).
//
// The tests make temp projects with `mkdtemp(os.tmpdir())` and most never remove them. On a machine whose /tmp is
// RAM (a tmpfs) a few days of runs fill memory and swap. So each process here gets a private folder as its
// temporary directory (`TMPDIR`), which is removed when the process ends; a test file's folder sits inside the
// runner's, so what a killed file leaves behind goes with the runner. Folders of runs that were killed
// outright (no chance to clean up) are swept at the start of the next run.
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PREFIX = "samurai-test-";

/** Whether a process with this id is still running */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // No permission to signal it means it exists
    return error.code === "EPERM";
  }
}

/** Removes the private folders in `parent` whose process is gone: `samurai-test-<pid>-<random>` */
function sweepStale(parent) {
  let names = [];
  try {
    names = readdirSync(parent);
  } catch {
    return;
  }
  for (const name of names) {
    const match = /^samurai-test-(\d+)-/.exec(name);
    if (match && !alive(Number(match[1])))
      rmSync(path.join(parent, name), { recursive: true, force: true });
  }
}

const parent = tmpdir();
sweepStale(parent);
const own = mkdtempSync(path.join(parent, `${PREFIX}${process.pid}-`));
process.env.TMPDIR = own;

let removed = false;
function remove() {
  if (removed) return;
  removed = true;
  rmSync(own, { recursive: true, force: true });
}
process.on("exit", remove);
// A termination signal ends the process with the exit event's cleanup (and the signal's usual exit code)
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    remove();
    process.exit(128 + { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 }[signal]);
  });
}

// A test file whose tests are all done but whose process stays up (a browser or socket a test left behind) holds
// the whole run: `node --test` waits for the file's process, and `--test-timeout` only covers tests. So once a test
// file's tests are done, it gets LINGER_MS to exit; after that it names what keeps it alive, kills the processes
// among it (a browser holds its debugging port and profile, which the next file needs) and exits failed.
const LINGER_MS = Number(process.env.SAMURAI_TEST_LINGER_MS) || 15000;
if (/\.browser-test\.ts$/.test(process.argv[1] ?? "")) {
  const { after } = await import("node:test");
  after(() => {
    setTimeout(() => {
      const alive = process._getActiveHandles().map((handle) => {
        const name = handle?.constructor?.name ?? typeof handle;
        if (name === "ChildProcess")
          return `${name} pid ${handle.pid}: ${handle.spawnfile}`;
        if (name === "Socket" && handle.remotePort)
          return `${name} to ${handle.remoteAddress}:${handle.remotePort}`;
        return name;
      });
      // Timers are not handles: they only show up among the resources
      const timers = process
        .getActiveResourcesInfo()
        .filter((kind) => kind === "Timeout").length;
      if (timers) alive.push(`${timers} timer(s), such as a test body's wait`);
      process.stderr.write(
        `${process.argv[1]}: still running ${LINGER_MS / 1000} s after its last test, held by:\n  ${alive.join("\n  ")}\n`,
      );
      for (const handle of process._getActiveHandles())
        if (handle?.constructor?.name === "ChildProcess")
          handle.kill("SIGKILL");
      process.exit(1);
    }, LINGER_MS).unref();
  });
}
