# Physics: quantum systems and circuits, PDE solvers, particle simulation, fitting.
ARG BASE=problemhive-sandbox-base:0.1.0
FROM ${BASE}
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
      lammps \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir qutip qiskit qiskit-aer scikit-fem fipy lmfit pint uncertainties
USER hive
