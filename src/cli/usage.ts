import { DEFAULT_PORT } from "../runner/run.js";

export const USAGE = `samurai: browser tests over WebDriver BiDi

Usage:
  samurai run [options]       Run the tests (the default command)
  samurai list [options]      List the tests without running them
  samurai record <spec>       Open a browser and record what you do into a spec file
  samurai init [folder]       Scaffold a project: config, an example test, .env.example
  samurai flow <command>      List, check and run the flows in ./flows (see below)
  samurai browsers [command]  List, install and remove the browsers SAMURAI launches

Options for run and list:
  --env <name>                Environment to run against (or SAMURAI_ENV)
  --file <spec>               Only this spec file; repeatable
  --grep <text>               Only tests whose full name contains the text
  --group <name>              Only the tests of this group of the config's groups
  --browser <name>            Run in this browser (firefox or chrome) instead of the config's
                              browsers; repeat it for more than one
  --json                      Machine-readable output: JSON lines for run, one array for list

Options for run:
  --timeout <ms>              Time one test may take
  --expect-timeout <ms>       Time actions and assertions retry
  --headless, --no-headless   Run the browser without a window, or with one.
                              Default: the config's use.headless, else headless when CI is set
  --port <n>                  Browser debugging port (default ${DEFAULT_PORT})

Options for record (also --env, --port, --json, --headless, --no-headless):
  --browser <name>            Record in this browser (default: the first of the config's browsers)
  --new <title>               Add a test with this title (creates the spec file if needed)
  --test <name|index>         Record into this test; not needed when the file has one
  --at <n>                    Insert from step n (default: after the last step)
  --url <url>                 Page to start on (default: the environment's baseURL)
  Stop with Ctrl+C or by closing the browser window.

  -h, --help                  Show this help
  -v, --version               Show the version

Exit code: 0 when every test passed, 1 when a test failed, 2 for a usage or configuration error.

samurai flow:
  list                        The flows in ./flows
  check [<flow>...]           Check flows without running them
  run <flow>... | --all       Run flows; each writes result/flows/<id>.json
  Options for run: --env, --headless, --timeout, --expect-timeout, --port, --json, --allow-unsupported
  Run \`samurai flow\` alone for the details.

samurai browsers:
  list                        The pinned browsers and every build in the cache (the default)
  install [firefox|chrome|all]
                              Download the pinned builds (default: all)
  uninstall <name> [--build <id>] | --unused

Run it in the project folder, the one holding samurai.config.ts.
`;
