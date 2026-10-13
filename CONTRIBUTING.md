# Contributing

Bug reports, fixes and new packs are welcome. This project gives an AI agent a confined place to run scientific tools, so two things matter more here than in most projects: that every tool it offers is known to work, and that nothing weakens the confinement.

## Running it

You need Docker and Node.js 18 or newer; there are no other dependencies.

```bash
git clone https://github.com/Egalitaristen/problemhive-tools-mcp
cd problemhive-tools-mcp
node src/cli.js setup        # gets the base pack and checks its tools
npm test                     # needs Docker running and the base pack
```

`npm test` starts the server the way an agent's app does and checks what an agent can and cannot do. One test downloads a small page, so it needs network access.

## Adding or changing a pack

A pack is one folder under `packs/` with a `Dockerfile` and a `pack.json`. The README section "Adding a pack" has the rules. In short:

- The Dockerfile starts with `ARG BASE` and `FROM ${BASE}`, installs as root, and ends as `USER hive`.
- Tools must work with a read-only system. Anything a tool wants to cache or write goes under `/tmp`, through the environment variable the tool offers for it. A tool that cannot be made to do that cannot be included.
- Every tool in `pack.json` has a `check`, a short command that proves it works, and the text its output must contain in `expect`. Keep checks to a second or two, and deterministic.
- `node src/cli.js install <pack> --build` builds it and runs every check with no network and the pack's stated minimum memory. A pack whose checks do not all pass is not ready.
- Prefer the distribution's packages and published wheels over building from source: they build in minutes and stay small. Fix the version of anything downloaded from a project's own site.
- Say what the tool is under which licence in `THIRD-PARTY.md`.

What will not be added: generative protein design, synthesis-route planners, tools specific to dangerous pathogens, and anything that is not open source. See "What the packs leave out" in the README.

## Changing the server

- No runtime dependencies. The server, including its MCP layer, is a few plain files on purpose, so that it can be read in full.
- Limits belong to the owner. Nothing an agent can call may raise a limit, install software, reach the network outside the approved sources, or touch a file outside its workspaces.
- Containers never run as root, and volumes are mounted only at `/work` and `/data`.
- A change in behaviour comes with a test in `test/`.
- Text that an agent or an owner reads is plain: short sentences, the reason given, written for someone who was not there.

## Pull requests

One change per pull request, with what it does, why, and how you tested it. Pull requests written with the help of an AI are fine; say so, and check the result yourself. The maintainer reviews and merges by hand, and images are published only from this repository's own workflow.

By sending a pull request you agree that your contribution is under the project's licence, MIT.

Security problems do not go in a public issue: see [SECURITY.md](SECURITY.md).
