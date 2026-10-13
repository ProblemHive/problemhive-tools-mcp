# Statistics: R with its main modelling packages, and Bayesian and econometric tools for Python.
ARG BASE=problemhive-tools-base:0.1.0
FROM ${BASE}
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
      r-base-core \
      r-cran-lme4 r-cran-nlme r-cran-mgcv r-cran-survival r-cran-metafor \
      r-cran-mass r-cran-boot r-cran-car r-cran-emmeans r-cran-sandwich r-cran-lmtest \
      r-cran-data.table r-cran-dplyr r-cran-tidyr r-cran-readr r-cran-ggplot2 r-cran-jsonlite \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir pymc arviz linearmodels lifelines pingouin
USER hive
# PyMC compiles its models; the compiled files go to the temporary area, the only other place a run can write.
ENV PYTENSOR_FLAGS=base_compiledir=/tmp/pytensor
