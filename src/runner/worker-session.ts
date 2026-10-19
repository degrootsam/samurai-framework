import { workerProfileDir } from "../browser/launch-flags.js";
import { withProject } from "./project.js";
import TestReporter from "./reporter.js";
import { runOneTest } from "./run-test.js";
import { loadSpecs } from "./select.js";
import type { WorkerSession } from "./worker.js";
import type { WorkerInit } from "./worker-protocol.js";

/**
 * Opens the project for a worker and keeps it open until `close`: `withProject` holds the config, environment
 * and secrets in place for as long as its callback runs, so the callback waits for the close
 */
export function openSession(init: WorkerInit): Promise<WorkerSession> {
  const { workerIndex, basePort, headless } = init;
  const port = basePort + workerIndex;
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => (release = resolve));

  return new Promise((resolve, reject) => {
    const finished = withProject(
      {
        projectDir: init.projectDir,
        ...(init.dataDir !== undefined && { dataDir: init.dataDir }),
        ...(init.environment !== undefined && {
          environment: init.environment,
        }),
        ...(init.timeout !== undefined && { timeout: init.timeout }),
        ...(init.expectTimeout !== undefined && {
          expectTimeout: init.expectTimeout,
        }),
        ...(headless !== undefined && { headless }),
      },
      async (run) => {
        const loaded = await loadSpecs(init.files);
        resolve({
          tests: loaded.all,
          async runTest(test, browser, signal, onEvent) {
            const reporter = new TestReporter({
              environment: run.settings.environment,
              browsers: [browser],
              output: false,
              onEvent,
            });
            await runOneTest(
              test,
              browser,
              run,
              {
                ...(headless !== undefined && { headless }),
                ...(init.reportPath !== undefined && {
                  reportPath: init.reportPath,
                }),
                port,
                signal,
              },
              loaded.srcDir,
              reporter,
              {
                port,
                profileDir: workerProfileDir(browser, workerIndex),
                workerIndex,
              },
            );
          },
          async close() {
            release();
            await finished;
          },
        });
        await released;
      },
    );
    finished.catch(reject);
  });
}
