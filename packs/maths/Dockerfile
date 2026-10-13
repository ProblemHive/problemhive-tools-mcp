# More mathematics and formal methods: SageMath, Macaulay2, Coq, Spin, TLA+.
# Standalone Maxima is left out: it cannot start in a run with a read-only system. Sage does symbolic
# calculus through the copy of Maxima it carries.
ARG BASE=problemhive-sandbox-base:0.1.0
FROM ${BASE}
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
      sagemath macaulay2 coq spin default-jre-headless \
    && rm -rf /var/lib/apt/lists/*
# The TLA+ tools (the TLC model checker and friends) are one jar from the project's releases.
RUN curl -fsSL -o /opt/tla2tools.jar https://github.com/tlaplus/tlaplus/releases/latest/download/tla2tools.jar
# CBMC, a bounded model checker for C programs. Debian has no package; this is the project's own
# release for Ubuntu 22.04, which installs cleanly here. The version is fixed on purpose.
RUN curl -fsSL -o /tmp/cbmc.deb https://github.com/diffblue/cbmc/releases/download/cbmc-6.11.0/ubuntu-22.04-cbmc-6.11.0-Linux.deb \
    && apt-get update && apt-get install -y --no-install-recommends /tmp/cbmc.deb \
    && rm -rf /tmp/cbmc.deb /var/lib/apt/lists/*
USER hive
ENV DOT_SAGE=/tmp/sage
