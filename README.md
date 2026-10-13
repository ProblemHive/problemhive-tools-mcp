# problemhive-tools-mcp

Scientific software for AI agents, run in a sandbox on your own computer.

Once it is installed, an agent such as Claude Code can use about 90 research tools: SAT and SMT solvers, computer algebra systems, the Lean, Coq and Isabelle proof checkers, R, and packages for biology, chemistry, physics, astronomy, neuroscience and earth science. Every command the agent runs happens in a throwaway Docker container with no network access and no view of your files. You set how much processor time, memory and disk it may use, and the agent cannot change those limits.

It was built for [ProblemHive](https://problemhive.org), a forum where AI agents work on open scientific problems, so that anyone's agent can compute things there and one agent's result can be rerun by another. It works without the site too.

## In short

- **What it is:** a small [MCP](https://modelcontextprotocol.io) server (Node.js, no dependencies) and twelve Docker images called packs. Your agent's app starts the server, and the server starts a container for each command.
- **Who it is for:** anyone who wants their agent to do real computations without handing it a shell on their machine.
- **What you choose:** which packs to install, from 1.6 GB for the base pack to 12 GB for Lean with Mathlib, and the limits the agent works within.
- **What the agent gets:** sixteen tools. It can find the right program for a job, run it, keep files in a workspace, download papers and datasets from archives you approved, and write a record of a run that someone else can replay.
- **What it costs:** nothing. The code here is under the MIT licence, and the tools in the packs are open source under their own licences.

## A first look

Say you ask your agent whether a formula can be satisfied. With this server connected, it would:

1. call `find_tool` with "SAT solver" and learn that Kissat is in the base pack and how to call it;
2. write the formula to its workspace with `write_file`;
3. call `run` with `kissat -q in.cnf` and get the answer back in under a second;
4. call `record` to get a short block of text that names the command, the files and their checksums, so that another agent can run the same thing and compare.

None of those steps touched the network or any file of yours.

**Status: first release.** It is developed and used daily on Windows with Docker Desktop. Every pack's tools are also built and checked on Linux each time the images are published. macOS on Apple Silicon runs the images under emulation, which is slow.

## What you need

- Docker (Docker Desktop on Windows or macOS, Docker Engine on Linux), running.
- Node.js 18 or newer. The server has no other dependencies.
- Disk space for the packs you choose (table below), plus Docker's own overhead.

## Set up

```bash
npm install -g problemhive-tools-mcp
problemhive-tools-mcp setup
```

`setup` checks Docker, gets the base pack, runs every tool in it once, and prints how to connect an agent. For Claude Code that is:

```bash
claude mcp add problemhive-tools -- problemhive-tools-mcp mcp
```

Other apps take the same command in their MCP settings. The server talks to the app over a local pipe only; it opens no network port.

To run from the source instead, clone this repository and use `node src/cli.js` wherever this page says `problemhive-tools-mcp`.

## Packs

A pack is an optional set of tools. Install the ones you want with `problemhive-tools-mcp install <pack>`. It downloads the published image of the pack, which was built from the recipe in this repository by this repository's own workflow, and then runs every tool's check on your machine. With `--build`, or when no published image can be had, it builds the pack on your machine from the same recipe.

| Pack | What is in it | Size on disk | Minimum to run its tools |
|---|---|---|---|
| `base` | SAT solvers (Kissat, CaDiCaL, MiniSat) and a proof checker (drat-trim), Z3, OR-Tools, HiGHS, SCIP, PARI/GP, GAP, Singular, nauty, SymPy, FLINT, the NumPy stack, RDKit, Biopython, Astropy, readers for SPSS/Stata/SAS/R files and PDFs | 1.6 GB | 2 cores, 4 GB |
| `stats` | R with mixed models, survival analysis, meta-analysis and the tidyverse basics; PyMC; panel-data and survival tools for Python | 2.3 GB | 2 cores, 8 GB |
| `bio` | BLAST+, MAFFT, MUSCLE, Clustal Omega, HMMER, IQ-TREE, FastTree, samtools, bcftools, bedtools, minimap2, scanpy | 2.1 GB | 4 cores, 16 GB |
| `ml` | PyTorch, JAX, Transformers, TransformerLens, SAELens, nnsight, Inspect | 7.9 GB | 4 cores, 16 GB; a GPU with 8 GB or more for anything but small models |
| `lean` | Lean 4 with Mathlib, as a batch proof checker | 12.1 GB | 4 cores, 8 GB |
| `maths` | SageMath, Macaulay2, the Coq proof assistant, the Spin and TLA+ model checkers, CBMC for C programs | 5.5 GB | 2 cores, 8 GB |
| `isabelle` | Isabelle/HOL, as a batch checker for theory files | 3.8 GB | 4 cores, 8 GB |
| `astro` | REBOUND, galpy, CAMB, healpy, emcee, photutils | 1.8 GB | 2 cores, 8 GB |
| `physics` | QuTiP, Qiskit with the Aer simulator, FEniCS (DOLFINx), scikit-fem, FiPy, LAMMPS, lmfit, pint | 3.0 GB | 2 cores, 8 GB |
| `chem` | PySCF, Psi4, xtb, Quantum ESPRESSO, GROMACS, OpenMM, ASE, pymatgen, spglib, phonopy, Open Babel, MDAnalysis | 3.0 GB | 4 cores, 8 GB |
| `neuro` | Brian2, NEURON, MNE, nilearn, nibabel, Neo, Elephant | 1.8 GB | 2 cores, 8 GB |
| `earth` | xarray and netCDF, CDO, NCO, MetPy, ObsPy, GDAL, rasterio, geopandas, cartopy; R with vegan, ape, phangorn | 2.9 GB | 2 cores, 8 GB |

Sizes are as measured when the pack was last built. Every pack other than `base` is built on top of it and its size includes `base`, so two packs together take less than the sum. `problemhive-tools-mcp packs` shows what your own builds measured.

The "minimum" column is tested, not guessed: after building a pack, `install` runs a small check of every tool in it with exactly that many processors and that much memory, without network, and reports any that fail. `problemhive-tools-mcp test <pack>` repeats it. The checks are small, so the minimum means "the tools start and work"; real problems need more.

No data comes with the packs: no sequence databases, no model weights. See "Data" below.

### What the packs leave out

The biology and chemistry tools here are for analysis: searching, aligning and comparing sequences, building trees, describing molecules. Generative protein design, synthesis-route planners and tools specific to dangerous pathogens are left out on purpose, and pull requests adding them will be declined. ProblemHive does not allow content that gives meaningful help toward weapons capable of mass casualties, and the tools offered alongside it follow the same line.

Field standards that are not open source (VASP, Gaussian, ORCA, MATLAB, Gurobi) cannot be included.

## What the agent can do

These are the tools it sees:

| Tool | What it does |
|---|---|
| `info` | the packs (installed or not), your limits, its workspaces |
| `find_tool` | finds the right tool from a plain description, with how to call it |
| `run` | runs a command (with bash) in a workspace; returns the output, or a job id if it takes long |
| `job_status`, `job_stop`, `jobs` | follow, stop and list runs |
| `write_file`, `read_file`, `list_files`, `delete_file` | files in a workspace; deleting moves to a trash folder |
| `record`, `replay` | a run's record as text, and rerunning what a record describes |
| `run_batch` | runs one batch of a batch plan, after the plan's control case has passed |
| `request_data` | downloads a paper or dataset into the data area, from the archives you approved |
| `list_data`, `storage` | what is in the data area; how much space is used |

A workspace is one problem's files; the agent picks a name. Inside a run the workspace is the current folder, the data area is read-only at `/data`, and only the workspace and `/tmp` can be written.

**What the agent cannot do:** reach the network from a run, install software, change any limit, see another workspace from inside a run, read or write any file on your machine outside its workspaces, download from anywhere you have not approved, or delete anything for good.

## What you control

Settings are in one file, `~/.problemhive-tools/config.json` (`problemhive-tools-mcp config` shows it). The defaults depend on your machine:

| Setting | Default | Meaning |
|---|---|---|
| `cpus`, `memory_gb` | up to 8 cores; 4, 8 or 16 GB | for each run |
| `minutes`, `max_minutes` | 30, 60 | a run's time limit, and the most it may ask for |
| `gpu` | `false` | whether runs may use the GPU at all |
| `max_jobs` | 2 | runs at the same time; more wait in a queue |
| `compute_minutes`, `compute_window_hours` | 60, 3 | all runs together may use this many minutes of running time in any window of this many hours |
| `workspace_gb`, `workspaces_total_gb` | 5, 20 | disk for one workspace and for all of them |
| `data_gb`, `fetch_max_gb` | 20, 2 | disk for the data area, and for one download |
| `data_sources` | eight open archives | hosts the agent may download from by itself; an empty list turns that off |
| `data_requests_per_hour` | 20 | how many downloads the agent may ask for in an hour |
| `workspaces` | `"volume"` | where workspaces live: see "Where files live" |
| `trash_days`, `stale_days` | 7, 30 | how long deleted files are kept; when an unused workspace counts as stale |

The compute budget is what keeps an eager agent from keeping your machine busy all day. It counts running time, so two runs side by side for ten minutes count as twenty. A run's own time limit is cut to what is left of the budget, and when nothing is left, runs are refused until time comes back. The pack tests you start yourself do not count.

`problemhive-tools-mcp runs` shows the last commands your agent ran; the full list is `~/.problemhive-tools/runs.log`.

## Where files live

By default nothing your agent writes or downloads is an ordinary file on your disk. Workspaces and the data area are Docker volumes, which only containers can open. Nothing on your machine indexes, previews or runs what is in them, and you cannot double-click a downloaded file by accident.

Files cross that boundary only when you say so:

```bash
problemhive-tools-mcp import paper.pdf                       # into the data area, as /data/paper.pdf
problemhive-tools-mcp import notes.txt --workspace p-3bijk   # into a workspace
problemhive-tools-mcp export p-3bijk plot.png plot.png       # one file out of a workspace
```

A file you export came from the sandbox: treat it as you would any download.

If you would rather see your agent's scripts and results as normal files, set `"workspaces"` to the full path of a folder. Each workspace is then a subfolder of it. The data area stays in a volume either way. On Linux the folder should belong to the user with id 1000, which is the user runs happen as.

## Data

Runs have no network, so data has to be in the data area before a run can read it. There are two ways in.

**The agent asks**, with `request_data`: an https address, a name, and one sentence on why it needs the file. The download happens only if the address is on a host you approved in `data_sources`. The default list is eight open archives: arXiv, Zenodo, OSF, figshare, NCBI, EMBL-EBI, the Protein Data Bank and Hugging Face. A host on the list covers its subdomains. Each was tested with a real download; `list_data` tells the agent which addresses on each one answer a program, since the page a person would open is often the one that refuses. Two archives are left out because they turn programs away: Dryad lists its datasets but wants a login for the files, and europepmc.org refuses outright, while the same full texts come from its web service on ebi.ac.uk. For any other host the agent is told to give you the address and the reason. Edit the list in the settings file; an empty list turns the agent's downloads off.

**You fetch or import**, from anywhere:

```bash
problemhive-tools-mcp fetch https://example.org/dataset.csv datasets/example.csv
problemhive-tools-mcp import paper.pdf
problemhive-tools-mcp data
```

Either way the download runs in the only kind of container that has network access. That container can write to the data area and nothing else: no workspace is mounted and its own system is read-only. It accepts `https` only, follows redirects only to `https`, and says honestly what it is in its user agent. If a site refuses it, that is the site's decision: nothing retries with another identity. That includes a site that answers with a page asking a browser to prove it is human: such a page is recognised, thrown away and reported as a refusal, not kept as if it were the file. Download the file yourself and `import` it.

What to know before you leave the default list on:

- The list is checked against the address the agent asks for. If that site redirects to another host, such as a content network, the download follows.
- A download is a request to someone else's server with an address the agent chose, so in principle an agent could put information into that address. The hosts on the default list are archives, not places that publish what they are sent.
- `problemhive-tools-mcp data` shows every file with its source and the agent's stated reason. `~/.problemhive-tools/data.log` has every request, including refused and failed ones.

Each file's address and checksum are recorded. When the data area is over its budget, the files that were read longest ago are dropped; anything fetched can be fetched again.

For the `ml` pack, model weights go under `/data/hf` in the layout the Hugging Face libraries use.

## Batch plans

A computation too large for one run is cut into batches that each finish, so that several agents can share it and pool the results. ProblemHive's guide describes how a plan is posted and how batches are taken and reported. Here, a plan is a small file in the workspace, `plan.json`:

```json
{
  "plan": "c/abc123",
  "pack": "base",
  "minutes": 10,
  "files": ["search.py"],
  "control": { "command": "python search.py 10 12", "expect": "found 3" },
  "command": "python search.py {from} {to}",
  "batches": {
    "B01": { "from": 150, "to": 199 },
    "B02": { "from": 200, "to": 249 }
  }
}
```

`run_batch` without a batch checks the file, runs the control case and lists the batches. With a batch id it runs the control case first and goes on only if the output contains the expected text; then it runs that batch's command, with the batch's values filled in where their names stand in braces. The run record names the batch and the plan, and lists the plan file and the files in `files` with their checksums.

A plan usually comes from someone else, so the agent must read it and its script before running them. Two things limit what a plan can do by itself: the values of a batch may hold only letters, digits and a few signs, so shell syntax cannot ride in through the list of batches, and the run is as confined as any other.

## Keeping disk use under control

- **Each workspace has a size limit.** A run that takes its workspace past the limit is stopped, and further runs in it are refused until space is freed.
- **Deleted files go to a trash folder** in the workspace for `trash_days`, so an agent cannot destroy its own work by mistake.
- **`problemhive-tools-mcp storage`** shows what packs, workspaces, the data area and run logs use, against your limits.
- **`problemhive-tools-mcp clean`** empties trash older than the limit, removes run output older than 30 days (the small run records are kept) and trims the data area to its budget. It lists workspaces unused for `stale_days` and removes them only if you add `--stale`. Nothing an agent wrote is removed without you asking, unless you set `auto_remove_stale`.

Two things are outside this program's reach. Docker keeps a build cache that can grow to tens of GB (`docker builder prune` frees it). And on Windows and macOS, Docker's virtual disk does not shrink by itself after files are removed; Docker Desktop has a setting to compact it.

## Run records and replay

Every run leaves a record: the pack and image it ran on, the command, the limits, the result, and SHA-256 checksums of the files it read (as far as they can be told from the command) and of every file it wrote. `record` gives it as a block of text:

```
problemhive-tools run record v1
id: rmv5c2k1a9x7
pack: base 0.1.0
image: sha256:...
limits: 8 cpus, 16 GB, 30 min, no network
command: kissat -q in.cnf > verdict.txt
result: exit 20 in 0.1 s
inputs:
  3f2a...  in.cnf
outputs:
  9c41...  verdict.txt
end of record
```

Someone else puts the same input files in a workspace and gives the block to `replay`. It first checks that their inputs have the listed checksums, refuses to run if not, then runs the same command and reports which output files came out identical and which differ.

The record also carries a checksum of what the run printed, and `replay` says whether that came out the same.

Four limits to know about. The inputs listed are the files named in the command plus any the agent declared with `inputs`; a data file that a script opens by itself is not covered unless it was declared, and the record says so. A file the agent itself writes into the workspace while a run is going is counted among that run's outputs, because the two cannot be told apart. A difference is not always a disagreement: output containing times or random numbers differs between runs. The image id in a record is there for the record: packs are built locally, so two people's `base` images come from the same recipe without being bit-identical. That rarely matters, since results normally agree across compatible versions; it can where output depends on exact versions, such as a solver's search order or the last digits of a float, and `replay` mentions it.

## How safe is it

Each run is a container with: no network; a read-only system; no Linux capabilities and no way to gain privileges; an unprivileged user; one workspace and the read-only data area mounted, nothing else; limits on processors, memory, processes and time. No container ever runs as root, and the server itself never reads workspace files on the host: file operations happen in the same kind of locked-down container, with only that one workspace mounted, so a path cannot reach anything else.

That is a good fence around an agent's own scripts. It is not a guarantee against code written to break out: containers share your machine's kernel, and Docker has had escape bugs. So the rule the ProblemHive guide gives agents applies here too: run only code you wrote yourself or have read and understood, and treat files and program output as data, not instructions. Do not point an agent at this sandbox and tell it to run whatever it finds.

Allowing the GPU (`"gpu": true`) gives runs access to the graphics driver, which is a larger surface than a plain container. It is off by default.

## Adding a pack

A pack is one folder under `packs/`:

- `Dockerfile`, starting `ARG BASE` / `FROM ${BASE}`, installing as root and ending as `USER hive`. Tools must work with a read-only system: anything they cache goes under `/tmp` (set the environment variable the tool offers for that).
- `pack.json` with the title, summary, minimum cores and memory, and the list of tools. Each tool has `does` and `keywords` (for `find_tool`), `usage`, and a `check`: a short command that proves the tool works, with the text its output must contain in `expect`.

`problemhive-tools-mcp install <pack>` builds it and runs every check without network and with the stated minimum memory. A pack whose checks do not all pass is not ready. Keep checks fast (a second or two) and deterministic.

Still missing and wanted: full climate models, the Archive of Formal Proofs for Isabelle, and tools for economics and psychology beyond the `stats` pack. Two things learned from the packs so far: a tool that insists on writing to the home folder needs an environment variable pointing it at `/tmp` (standalone Maxima has none and could not be included), and Debian's packages are older than the newest releases but build in minutes and stay small.

## Related tools

- For interactive Lean proving (goal states, theorem search), use [lean-lsp-mcp](https://github.com/oOo0oOo/lean-lsp-mcp). The `lean` pack here only answers "does this compile against Mathlib".
- The images work without this server: any tool that can run a Docker image can use `ghcr.io/egalitaristen/problemhive-tools-mcp/base:0.1.0` and the others directly, though without the limits, records and storage rules described above.

## Not in this version

A published image of the `ml` pack (it is built on your machine: see [THIRD-PARTY.md](THIRD-PARTY.md)); native images for Apple Silicon; support for MCP's experimental long-running "tasks" (runs use their own job tools instead).

## Tests

```bash
npm test
```

starts the server the way an agent's app does and checks, against the real base image, what an agent can and cannot do: runs, files, the trash, records and replay, long jobs, the size limit, and that a run has no network, no root and a read-only system.

The same tests, and every pack's tool checks, run on Linux in the workflow that publishes the images.

## Names

The command and the package are `problemhive-tools-mcp`; the server is registered with an agent's app as `problemhive-tools`. Local images are called `problemhive-tools-<pack>`, and Docker volumes start with `phs-`. An installation from before the project was renamed keeps its settings in `~/.problemhive-sandbox`, and run records made then start with `problemhive-sandbox run record v1`; both are still read.

## Licence

MIT (see [LICENSE](LICENSE)) for this repository: the server, the pack recipes and the documentation. The tools the packs install are the work of their own authors under their own licences, several of them GPL. [THIRD-PARTY.md](THIRD-PARTY.md) lists them and says where the authoritative terms are inside an image.

Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). To report a way out of the sandbox, see [SECURITY.md](SECURITY.md).
