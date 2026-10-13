# Physics: quantum systems and circuits, PDE solvers, particle simulation, fitting.
ARG BASE=problemhive-tools-base:0.1.0
FROM ${BASE}
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
      lammps \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir qutip qiskit qiskit-aer scikit-fem fipy lmfit pint uncertainties
# FEniCS (DOLFINx), the finite-element system. Debian builds it for its own Python, not the one the
# other tools here use, so it gets its own command: fenics-python.
RUN apt-get update && apt-get install -y --no-install-recommends python3-dolfinx && rm -rf /var/lib/apt/lists/* \
    && printf '#!/bin/sh\nexec /usr/bin/python3 "$@"\n' > /usr/local/bin/fenics-python && chmod +x /usr/local/bin/fenics-python
USER hive
# MPI refuses to start as it finds no way to reach other machines; one machine is all there is.
ENV OMPI_MCA_rmaps_base_oversubscribe=1 OMPI_MCA_plm_rsh_agent=
