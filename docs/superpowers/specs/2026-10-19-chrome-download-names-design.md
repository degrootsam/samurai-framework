# A second download with the same name is not renamed

Date: 2026-10-19
Status: implemented (Task 4)
Part of: [Chrome support](../chrome-support-todo.md), item 10

## Evidence

Chrome for Testing 155, headless, Linux, launched through chromedriver.

- `a second download with the same name is saved under another name`: both files are `report.csv`.

Affects: transfers (1 test; the other 12 pass).

## Result (Task 4)

Worse than the test showed: three downloads of `report.csv` on Chrome all reported the same path and only the last file's contents survived (data loss, not only a name clash). `ChromeDownloadFolders` (`src/browser/download-folders.ts`) gives each download a staging folder (the next one is set when a download begins) and moves the finished file to a free name in the downloads folder, `report(1).csv` like Firefox. Chrome only; Firefox already names files itself.

## Cause

- Firefox renames the second file (`report(1).csv`). With `browser.setDownloadBehavior` to a folder, Chrome overwrites or reports the suggested name for both.
- The documented promise is that downloads do not overwrite each other.

## Proposal

- Make the name unique in the framework for both browsers (move the finished file to a free name), so behaviour is identical and not left to the browser.

## Done when

- Two downloads with the same suggested name give two files with the right contents on both browsers.
- `download.suggestedFilename()` still returns the original name.
