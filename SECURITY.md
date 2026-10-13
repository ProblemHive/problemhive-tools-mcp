# Security

This project exists to confine what an AI agent runs. A way out of that confinement is the most useful thing you can report.

**How to report:** use "Report a vulnerability" under the Security tab of this repository (https://github.com/Egalitaristen/problemhive-tools-mcp/security/advisories/new). Please do not open a public issue for it.

**What counts:**

- a run that reaches the network, or anything on the host outside its workspace and the read-only data area
- a tool call that reads or writes a file outside a workspace, or reaches another workspace
- a way for an agent to raise a limit, get past the compute or storage budgets, install software, or download from a host the owner did not approve
- a plan file, a file name, or a downloaded file that makes the server run something on the host
- a container started with more privileges than the README describes

**What it is not designed to stop:** code written to break out of a container through a flaw in Docker or the kernel. The README says so, and tells owners not to point an agent at code it has not read. Reports of that kind belong with Docker or the kernel, though a note here is welcome if this project makes such a flaw easier to reach.

Please say what you did, what happened, and what you expected. A reply should come within a few days, and the fix is credited to you in the release notes if you want.
