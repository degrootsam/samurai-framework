import { DEFAULT_PORT } from "../runner/run.js";

export const USAGE = `samurai: browser tests over WebDriver BiDi

Usage:
  samurai run [options]       Run the tests (the default command)
  samurai list [options]      List the tests without running them
  samurai record <spec>       Open a browser and record what you do into a spec file
  samurai plan "<goal>"       Let an AI agent explore a page and write a test plan (Markdown); it submits nothing
  samurai generate "<goal>"   Let an AI agent write a test into a spec file (needs ai, zod and a provider)
  samurai init [folder]       Scaffold a project: config, an example test, .env.example
  samurai flow <command>      List, check and run the flows in ./flows (see below)
  samurai browsers [command]  List, install and remove the browsers SAMURAI launches

Options for run and list:
  --env <name>                Environment to run against (or SAMURAI_ENV)
  --file <spec>               Only this spec file; repeatable
  --grep <text>               Only tests whose full name contains the text
  --group <name>              Only the tests of this group of the config's groups; repeat it for several
  --browser <name>            Run in this browser (firefox or chrome) instead of the config's
                              browsers; repeat it for more than one
  --json                      Machine-readable output: JSON lines for run, one array for list

Options for run:
  --timeout <ms>              Time one test may take
  --expect-timeout <ms>       Time actions and assertions retry
  --headless, --no-headless   Run the browser without a window, or with one.
                              Default: the config's use.headless, else headless when CI is set
  --port <n>                  Browser debugging port (default ${DEFAULT_PORT})
  --workers <n|n%>            Tests that run at the same time, each in a worker process: a number
                              from 1, or a share of the CPUs like 50%. Default: the config's
                              workers (or SAMURAI_WORKERS), else half the CPUs
  --retries <n>               Run a failing test again up to n times, each with a fresh browser
                              (or SAMURAI_RETRIES; default 0)
  --shard <current/total>     Run one slice of the selected tests, to split a run over machines:
                              --shard=2/4 runs the second of four. Whole files (and serial
                              blocks) go to one shard; an empty shard succeeds

Options for record (also --env, --port, --json; always with a window):
  --browser <name>            Record in this browser (default: the first of the config's browsers)
  --new <title>               Add a test with this title (creates the spec file if needed)
  --test <name|index>         Record into this test; not needed when the file has one
  --at <n>                    Insert from step n (default: after the last step)
  --url <url>                 Page to start on (default: the environment's baseURL)
  Stop with Ctrl+C or by closing the browser window.

Options for plan (also --env, --browser, --port, --headless, --json and the model, limit and
origin options of generate below):
  --out <plan.md>             The plan file to write (required); written after every step
  --force                     Replace --out when it exists
  The page is read-only while planning: every request that is not a GET is blocked.

Options for generate (also --env, --browser, --port, --headless, --json):
  --file <spec>               The spec file to write into (required, once)
  --plan <plan.md>            A plan from samurai plan: the agent follows it and checks each step
  --new <title>               Add a test with this title (creates the file if needed)
  --test <name|index>         Write into this test; not needed when the file has one
  --url <url>                 Page to start on (default: the environment's baseURL)
  --model <provider:name>     anthropic, openai or openai-compatible, for example
                              anthropic:claude-sonnet-4-5. Default: SAMURAI_AI_MODEL, then the
                              config's ai.model. Keys: ANTHROPIC_API_KEY, OPENAI_API_KEY,
                              SAMURAI_AI_API_KEY (+ SAMURAI_AI_BASE_URL for openai-compatible)
  --max-steps <n>             Most model calls in the run (default 40)
  --yes-origin <origin>       A site the agent may open without asking; repeatable
  --secret <NAME>             A secret the agent may type (it never sees the value); repeatable
  --secret-field <css>        A field whose value is never shown to the model; repeatable
  Questions are asked in the terminal; without one (or with --json) an unknown site is refused
  and any other question ends the run.

  -h, --help                  Show this help
  -v, --version               Show the version

Exit code: 0 when every test passed (generate, plan: the agent finished), 1 when a test failed (generate, plan: it ended at a limit, was stopped or failed), 2 for a usage or configuration error.

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
