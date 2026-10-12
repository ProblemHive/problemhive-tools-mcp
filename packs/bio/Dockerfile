# Biology: sequence search and alignment, phylogenetics, read handling, single-cell analysis.
# Analysis tools only. Generative protein design, synthesis-route planners and pathogen-specific
# tools are left out on purpose; see README, "What the packs leave out".
ARG BASE=problemhive-sandbox-base:0.1.0
FROM ${BASE}
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
      ncbi-blast+ mafft muscle clustalo hmmer \
      iqtree fasttree \
      samtools bcftools bedtools seqtk minimap2 \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir scanpy anndata pysam dendropy
USER hive
ENV NUMBA_CACHE_DIR=/tmp/numba
