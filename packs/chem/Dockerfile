# Chemistry and materials: electronic structure, molecular dynamics, structure handling.
ARG BASE=problemhive-sandbox-base:0.1.0
FROM ${BASE}
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
      xtb psi4 gromacs quantum-espresso openbabel \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir pyscf openmm ase pymatgen phonopy spglib MDAnalysis
USER hive
ENV PSI_SCRATCH=/tmp XTBPATH=/usr/share/xtb
