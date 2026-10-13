# Astronomy: N-body and galactic dynamics, cosmology, sky maps, fitting.
ARG BASE=problemhive-tools-base:0.1.0
FROM ${BASE}
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgsl-dev gfortran \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir rebound galpy camb healpy emcee corner photutils
USER hive
