# Argus Actions

Adds an **Actions** tab to the Argus Control Centre: GitHub Actions runs, deployment approvals and workflow
dispatch, driven by the `gh` CLI.

## Features

- **Awaiting approval**: every waiting run with a pending deployment you (or someone else) can approve, with the
  gates it's stuck on and one-click Approve/Reject (with an optional comment).
- **Runs**: recent workflow runs, filterable to manual dispatches, your own runs, or everything. Expand a run to
  see its jobs; re-run failed jobs or cancel a run in progress.
- **Run workflow**: any workflow with a `workflow_dispatch` trigger, parsed from its YAML, with a form built from
  its declared inputs (choice, boolean, number, string, environment) and branch.
- A status bar item shows how many runs are waiting for your approval and opens the tab; the tab itself carries the
  same count as a badge.

## Requirements

- The [GitHub CLI](https://cli.github.com) (`gh`), signed in (`gh auth login`) with access to the repo.

## Settings

- `argus.actions.repo`: GitHub repo (`owner/name`) to show. Defaults to the GitHub origin remote of the first
  workspace folder that has one.
- `argus.actions.refreshSeconds` (default 30): how often the Actions tab refreshes while it is visible.
- `argus.actions.backgroundRefreshSeconds` (default 120): how often approvals are checked while the tab is not
  visible.
- `argus.actions.appPattern`: optional regular expression matched against job names to label a run with the app it
  touches. The first capture group, or the whole match, names the app.

## API calls

While the Actions tab is visible, on the cadence in `argus.actions.refreshSeconds` (and once when it becomes
visible): the waiting runs and their pending deployments, up to three run lists (recent, manual dispatches, your
own), jobs for running and manually-dispatched runs, and (at most every 30 minutes) the repo's active workflows and
their YAML, to find `workflow_dispatch` triggers and inputs.

While the tab is not visible, on the cadence in `argus.actions.backgroundRefreshSeconds`: only the waiting runs,
their pending deployments and jobs — enough for the status bar item and the tab badge. Nothing is fetched if no
GitHub repo can be resolved.

Approving, rejecting, dispatching a workflow, re-running failed jobs and cancelling a run each make one `gh api`
call, followed by a refresh a few seconds later.

## Commands

- `Argus: Open GitHub Actions` (`argus.actions.open`)
- `Argus: Refresh GitHub Actions` (`argus.actions.refresh`)
