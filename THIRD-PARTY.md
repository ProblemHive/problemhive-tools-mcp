# Software in the packs

The MIT licence of this repository covers the server, the pack recipes and the documentation. It does not cover the tools the packs install. Each of those is the work of its own authors under its own licence, and an image built or downloaded for a pack is a collection of them.

Where to find the authoritative terms inside an image:

- for software installed from Debian: `/usr/share/doc/<package>/copyright`
- for Python packages: `pip show <package>`, and the licence files under the package's folder in `site-packages`
- for R packages: `packageDescription("<package>")$License`

The sources of everything installed from Debian are available from Debian (`apt-get source <package>`), and of everything from PyPI and CRAN from those archives. Software fetched from a project's own site is named, with its address and version, in the pack's `Dockerfile`.

The table lists the main tools and the licence each is released under, to the best of our knowledge at the time of writing. It is a guide, not a legal statement; if it differs from what the tool itself says, the tool is right, and a correction is welcome.

| Pack | Tool | Licence |
|---|---|---|
| base | Kissat, CaDiCaL, MiniSat, drat-trim | MIT |
| base | Z3 | MIT |
| base | OR-Tools | Apache-2.0 |
| base | HiGHS | MIT |
| base | SCIP (with PySCIPOpt) | Apache-2.0 (MIT) |
| base | PARI/GP, GAP | GPL-2.0-or-later |
| base | Singular | GPL-2.0 or GPL-3.0 |
| base | nauty | Apache-2.0 |
| base | SymPy, NumPy, SciPy, pandas, scikit-learn, NetworkX, statsmodels, Astropy, RDKit | BSD-3-Clause |
| base | python-flint (FLINT) | MIT (LGPL-3.0-or-later) |
| base | Biopython | Biopython License / BSD-3-Clause |
| base | Poppler (pdftotext) | GPL-2.0 or GPL-3.0 |
| base | GCC with gfortran | GPL-3.0 with the GCC runtime library exception |
| base | CMake, Graphviz | BSD-3-Clause, EPL-2.0 |
| base | Tesseract | Apache-2.0 |
| base | Info-ZIP zip and unzip, 7-Zip (p7zip), Zstandard | Info-ZIP licence, LGPL-2.1-or-later with an unRAR restriction, BSD-3-Clause or GPL-2.0 |
| base | jq, ripgrep, SQLite | MIT, MIT or Unlicense, public domain |
| base | gawk, bc, GNU parallel | GPL-3.0-or-later |
| base | openpyxl, xlrd, odfpy, python-docx, pdfplumber | MIT, BSD-3-Clause, Apache-2.0 or GPL, MIT, MIT |
| base | lxml, Beautiful Soup, xmltodict, chardet | BSD-3-Clause, MIT, MIT, LGPL-2.1 |
| base | h5py, netCDF4, xarray, pyarrow | BSD-3-Clause, MIT, Apache-2.0, Apache-2.0 |
| base | DuckDB, Polars | MIT |
| base | numba, Cython, gmpy2 | BSD-2-Clause, Apache-2.0, LGPL-3.0-or-later |
| base | cvxpy, PuLP, python-igraph | Apache-2.0, MIT, GPL-2.0-or-later |
| base | seaborn, pingouin | BSD-3-Clause, GPL-3.0 |
| base | pytest, hypothesis, tqdm, tabulate, jsonschema | MIT, MPL-2.0, MPL-2.0 and MIT, MIT, MIT |
| stats | R and most of its packages (lme4, survival, mgcv, metafor) | GPL-2.0 or GPL-3.0 |
| stats | PyMC, ArviZ | Apache-2.0 |
| stats | lifelines | MIT |
| bio | BLAST+ | public domain (US government work) |
| bio | MAFFT, HMMER, Clustal Omega, MUSCLE | BSD-style, BSD-3-Clause, GPL-2.0, GPL-3.0 |
| bio | IQ-TREE, FastTree | GPL-2.0 |
| bio | samtools, bcftools, minimap2, seqtk, bedtools | MIT (bedtools: MIT) |
| bio | scanpy, anndata | BSD-3-Clause |
| ml | PyTorch | BSD-3-Clause, with NVIDIA's CUDA libraries under NVIDIA's own terms |
| ml | JAX, Transformers, Inspect | Apache-2.0 (Inspect: MIT) |
| ml | TransformerLens, SAELens, nnsight | MIT |
| lean | Lean 4, Mathlib | Apache-2.0 |
| isabelle | Isabelle | BSD-3-Clause, with bundled components under their own terms |
| maths | SageMath | GPL-2.0-or-later |
| maths | Macaulay2 | GPL-2.0 or GPL-3.0 |
| maths | Coq | LGPL-2.1 |
| maths | Spin | BSD-3-Clause |
| maths | TLA+ tools | MIT |
| maths | CBMC | BSD-4-Clause |
| astro | REBOUND | GPL-3.0 |
| astro | galpy, emcee, photutils | BSD-3-Clause (emcee: MIT) |
| astro | CAMB | LGPL-3.0 with additional terms, see its licence file |
| astro | healpy | GPL-2.0 |
| physics | QuTiP | BSD-3-Clause |
| physics | Qiskit, Qiskit Aer | Apache-2.0 |
| physics | FEniCS (DOLFINx) | LGPL-3.0-or-later |
| physics | scikit-fem, lmfit, pint | BSD-3-Clause |
| physics | LAMMPS | GPL-2.0 |
| chem | PySCF | Apache-2.0 |
| chem | Psi4, xtb | LGPL-3.0 |
| chem | Quantum ESPRESSO | GPL-2.0-or-later |
| chem | GROMACS | LGPL-2.1-or-later |
| chem | OpenMM | MIT and LGPL |
| chem | ASE, MDAnalysis | LGPL-2.1-or-later (MDAnalysis: GPL-2.0-or-later, moving to LGPL) |
| chem | pymatgen, spglib, phonopy | MIT, BSD-3-Clause |
| chem | Open Babel | GPL-2.0 |
| neuro | Brian2 | CeCILL-2.1 |
| neuro | NEURON | BSD-3-Clause |
| neuro | MNE, nilearn, Neo, Elephant | BSD-3-Clause |
| neuro | nibabel | MIT |
| earth | xarray | Apache-2.0 |
| earth | CDO, NCO | BSD-3-Clause |
| earth | GDAL, rasterio, pyproj, Shapely, GeoPandas | MIT, BSD-3-Clause |
| earth | MetPy | BSD-3-Clause |
| earth | ObsPy, cartopy | LGPL-3.0 |
| earth | vegan, ape, phangorn (R) | GPL-2.0 or later |

**The ml pack is not published as an image.** It contains NVIDIA's CUDA libraries, which come with PyTorch's ordinary install. Whether a third party may pass those on inside an image has not been cleared, so that pack is built on the user's own machine, where it is the user who downloads them.
